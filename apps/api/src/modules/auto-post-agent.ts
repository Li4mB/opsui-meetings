import { nanoid } from "nanoid";
import sharp from "sharp";
import { autoPostAgentCadenceSchema } from "@opsui/shared";
import type { AutoPostAgentCadence } from "@opsui/shared";
import { storage } from "../db/database.js";
import { generatePostImageForRequest, runPlanner } from "./ai.js";
import { listConfiguredSocialAccounts } from "./social-publisher.js";
import type { DbScheduledSocialPostRow } from "../types.js";

const AGENT_INTERVAL_MS = 5 * 60 * 1000;
// Don't let unreviewed drafts pile up without a human clearing them.
const MAX_OUTSTANDING_DRAFTS = 8;

const weekdayIndex: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const getLocalParts = (timezone: string, now: Date) => {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? "";
    const weekday = weekdayIndex[get("weekday")] ?? now.getDay();
    const hour = Number(get("hour"));
    const minute = Number(get("minute"));

    return { weekday, totalMinutes: hour * 60 + minute };
  } catch {
    return { weekday: now.getDay(), totalMinutes: now.getHours() * 60 + now.getMinutes() };
  }
};

const shouldRunNow = (
  cadence: AutoPostAgentCadence,
  lastRunAt: string | null,
  timezone: string,
  now: Date,
): boolean => {
  const sinceLastMs = lastRunAt ? now.getTime() - new Date(lastRunAt).getTime() : Infinity;

  if (cadence.mode === "rate") {
    const minGapMs = Math.floor((24 * 60 * 60 * 1000) / cadence.perDay);
    return sinceLastMs >= minGapMs;
  }

  // schedule mode: a configured slot on an allowed weekday, fired once per slot.
  const { weekday, totalMinutes } = getLocalParts(timezone, now);

  if (!cadence.days.includes(weekday)) {
    return false;
  }

  const inSlot = cadence.times.some((time) => {
    const [h, m] = time.split(":").map(Number);
    const slot = h * 60 + m;
    return totalMinutes >= slot && totalMinutes < slot + AGENT_INTERVAL_MS / 60000;
  });

  // The > 30min guard stops the same slot window re-firing across ticks.
  return inSlot && sinceLastMs > 30 * 60 * 1000;
};

const buildThumbnail = async (imageDataUrl: string): Promise<string | null> => {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(imageDataUrl);

  if (!match) {
    return null;
  }

  try {
    const thumb = await sharp(Buffer.from(match[2], "base64"))
      .resize({ width: 320 })
      .jpeg({ quality: 60 })
      .toBuffer();
    return `data:image/jpeg;base64,${thumb.toString("base64")}`;
  } catch {
    return null;
  }
};

const runAgentTick = async (
  log: import("fastify").FastifyBaseLogger,
): Promise<void> => {
  const config = await storage.getAutoPostAgentConfig();

  if (!config || config.enabled !== 1 || !config.updated_by_user_id) {
    return;
  }

  const cadence = autoPostAgentCadenceSchema.safeParse(
    JSON.parse(config.cadence_json || "{}"),
  );

  if (!cadence.success) {
    return;
  }

  const now = new Date();

  if (!shouldRunNow(cadence.data, config.last_run_at, config.timezone, now)) {
    return;
  }

  // Don't generate while a backlog of unreviewed drafts is waiting.
  const allPosts = await storage.listScheduledSocialPosts();
  const outstanding = allPosts.filter(
    (post) => post.status === "pending_review",
  ).length;

  if (outstanding >= MAX_OUTSTANDING_DRAFTS) {
    return;
  }

  // Atomically win this slot before any (expensive) generation.
  const claimed = await storage.claimAutoPostAgentRun(
    config.last_run_at,
    now.toISOString(),
  );

  if (!claimed) {
    return;
  }

  let targetAccountIds: string[] = [];

  try {
    const parsed = JSON.parse(config.target_account_ids_json) as unknown;
    if (Array.isArray(parsed)) {
      targetAccountIds = parsed.filter((id): id is string => typeof id === "string");
    }
  } catch {
    targetAccountIds = [];
  }

  const connected = (await listConfiguredSocialAccounts()).filter((account) =>
    Boolean(account.accessToken),
  );
  const accountById = new Map(connected.map((account) => [account.id, account]));
  const resolvedIds = (
    targetAccountIds.length
      ? targetAccountIds.filter((id) => accountById.has(id))
      : connected.map((account) => account.id)
  );

  if (!resolvedIds.length) {
    log.warn("Auto-post agent: no connected target accounts; skipping run.");
    return;
  }

  const ownerId = config.updated_by_user_id;
  // The owner is the FK creator of every drafted post. If they were deleted,
  // skip the run (the insert would fail anyway) rather than waste generation.
  const owner = await storage.findUserById(ownerId);

  if (!owner || !owner.active) {
    log.warn("Auto-post agent: config owner no longer active; skipping run.");
    return;
  }

  const createdAt = now.toISOString();
  const rows: DbScheduledSocialPostRow[] = [];
  const postsToCreate = Math.min(config.posts_per_run, 4);

  for (let index = 0; index < postsToCreate; index += 1) {
    try {
      const plan = await runPlanner({
        userId: ownerId,
        targetAccountIds: resolvedIds,
        guidance: `Prefer ${config.image_style} image style.`,
        timezone: config.timezone,
        nowIso: createdAt,
      });
      const image = await generatePostImageForRequest(
        {
          prompt: plan.imagePrompt,
          caption: plan.caption,
          tags: plan.hashtagBank.slice(0, 12),
          conversationId: `agent-${ownerId}`,
          style: plan.imageStyle,
        },
        ownerId,
      );
      const thumbnail = await buildThumbnail(image.imageDataUrl);
      const scheduledFor = plan.suggestedPostTime.isoTime
        ? new Date(plan.suggestedPostTime.isoTime).toISOString()
        : new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      const statusMessage = `Auto-drafted (${plan.framework}): ${plan.angle}`.slice(
        0,
        500,
      );
      const enqueue = (accountId: string, caption: string) => {
        const account = accountById.get(accountId);

        if (!account) {
          return false;
        }

        rows.push({
          id: `${account.platform}-${nanoid()}`,
          platform: account.platform,
          account_id: account.id,
          caption: caption.trim(),
          image_data_url: image.imageDataUrl,
          image_name: image.fileName,
          thumbnail_data_url: thumbnail,
          scheduled_for: scheduledFor,
          timezone: config.timezone,
          status: "pending_review",
          status_message: statusMessage,
          external_post_id: null,
          published_at: null,
          created_by_user_id: ownerId,
          created_at: createdAt,
          updated_at: createdAt,
        });
        return true;
      };

      let queuedForPlan = 0;
      for (const target of plan.recommendedAccounts) {
        if (enqueue(target.accountId, target.captionTweak ?? plan.caption)) {
          queuedForPlan += 1;
        }
      }

      // The model may echo an unconnected/hallucinated id; never drop the post —
      // fall back to all resolved target accounts so the draft isn't lost.
      if (queuedForPlan === 0) {
        log.warn(
          "Auto-post agent: planner recommended no connected accounts; using all targets.",
        );
        for (const accountId of resolvedIds) {
          enqueue(accountId, plan.caption);
        }
      }
    } catch (error) {
      // Already advanced last_run_at via the claim, so a failure won't hot-loop.
      log.error({ err: error }, "Auto-post agent: failed to draft a post.");
    }
  }

  if (rows.length) {
    await storage.insertScheduledSocialPosts(rows);
    log.info(`Auto-post agent: drafted ${rows.length} post(s) for review.`);
  }
};

export const startAutoPostAgent = (app: import("fastify").FastifyInstance) => {
  const run = () => {
    void runAgentTick(app.log).catch((error) => {
      app.log.error({ err: error }, "Auto-post agent tick failed.");
    });
  };
  const timer = setInterval(run, AGENT_INTERVAL_MS);

  run();

  app.addHook("onClose", (_instance, done) => {
    clearInterval(timer);
    done();
  });
};

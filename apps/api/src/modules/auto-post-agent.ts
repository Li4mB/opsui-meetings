import { nanoid } from "nanoid";
import sharp from "sharp";
import { autoPostAgentCadenceSchema } from "@opsui/shared";
import type { AutoPostAgentSlot } from "@opsui/shared";
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

// Each timeslot is independent: its own days + time, fired once per slot window.
const shouldRunSlotNow = (
  slot: AutoPostAgentSlot,
  slotLastFiredAt: string | null,
  timezone: string,
  now: Date,
): boolean => {
  const { weekday, totalMinutes } = getLocalParts(timezone, now);

  if (!slot.days.includes(weekday)) {
    return false;
  }

  const [h, m] = slot.time.split(":").map(Number);
  const slotMin = h * 60 + m;
  const inWindow =
    totalMinutes >= slotMin && totalMinutes < slotMin + AGENT_INTERVAL_MS / 60000;

  if (!inWindow) {
    return false;
  }

  // The > 30min guard stops the same slot window re-firing across ticks.
  const sinceMs = slotLastFiredAt
    ? now.getTime() - new Date(slotLastFiredAt).getTime()
    : Infinity;
  return sinceMs > 30 * 60 * 1000;
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

  if (!cadence.success || !cadence.data.slots.length) {
    return;
  }

  let slotRuns: Record<string, string | null> = {};
  try {
    const parsed = JSON.parse(config.slot_runs_json || "{}") as unknown;
    if (parsed && typeof parsed === "object") {
      slotRuns = parsed as Record<string, string | null>;
    }
  } catch {
    slotRuns = {};
  }

  const now = new Date();
  const dueSlots = cadence.data.slots.filter((slot) =>
    shouldRunSlotNow(slot, slotRuns[slot.id] ?? null, config.timezone, now),
  );

  if (!dueSlots.length) {
    return;
  }

  // Shared draft budget across every slot firing this tick.
  const allPosts = await storage.listScheduledSocialPosts();
  let remainingBudget =
    MAX_OUTSTANDING_DRAFTS -
    allPosts.filter((post) => post.status === "pending_review").length;

  if (remainingBudget <= 0) {
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

  const connected = (await listConfiguredSocialAccounts()).filter((account) =>
    Boolean(account.accessToken),
  );
  const accountById = new Map(connected.map((account) => [account.id, account]));

  const createdAt = now.toISOString();
  const rows: DbScheduledSocialPostRow[] = [];

  for (const slot of dueSlots) {
    if (remainingBudget <= 0) {
      break;
    }

    // The slot's accounts are authoritative (empty = all connected).
    const slotAccountIds = slot.accountIds.length
      ? slot.accountIds.filter((id) => accountById.has(id))
      : connected.map((account) => account.id);

    if (!slotAccountIds.length) {
      log.warn(`Auto-post agent: slot ${slot.id} has no connected accounts; skipping.`);
      continue;
    }

    // Atomically win this slot before any (expensive) generation.
    const claimed = await storage.claimAutoPostAgentSlot(
      slot.id,
      slotRuns[slot.id] ?? null,
      createdAt,
    );

    if (!claimed) {
      continue;
    }

    slotRuns[slot.id] = createdAt;
    const postsToCreate = Math.min(slot.postsPerRun, 4);

    for (let index = 0; index < postsToCreate; index += 1) {
      if (remainingBudget <= 0) {
        break;
      }

      try {
        const plan = await runPlanner({
          userId: ownerId,
          targetAccountIds: slotAccountIds,
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
        // Planner writes content + optional per-account caption tweaks; the
        // SLOT decides which accounts the post goes to (not the planner).
        const tweakByAccount = new Map(
          plan.recommendedAccounts.map((target) => [target.accountId, target.captionTweak]),
        );

        for (const accountId of slotAccountIds) {
          if (remainingBudget <= 0) {
            break;
          }

          const account = accountById.get(accountId);
          if (!account) {
            continue;
          }

          rows.push({
            id: `${account.platform}-${nanoid()}`,
            platform: account.platform,
            account_id: account.id,
            caption: (tweakByAccount.get(accountId) ?? plan.caption).trim(),
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
          remainingBudget -= 1;
        }
      } catch (error) {
        // Already claimed the slot, so a failure won't hot-loop.
        log.error({ err: error }, "Auto-post agent: failed to draft a post.");
      }
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

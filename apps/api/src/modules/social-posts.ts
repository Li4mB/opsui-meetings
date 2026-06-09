import {
  autoPostAgentCadenceSchema,
  autoPostAgentConfigSchema,
  autoPostAgentConfigResponseSchema,
  bulkReviewSocialPostsInputSchema,
  connectSocialAccountInputSchema,
  duplicateScheduledPostInputSchema,
  editScheduledPostCaptionInputSchema,
  publishSocialPostsInputSchema,
  publishSocialPostsResponseSchema,
  rescheduleSocialPostInputSchema,
  reviewSocialPostInputSchema,
  socialAccountSchema,
  socialAccountsResponseSchema,
  scheduledSocialPostSchema,
  scheduledSocialPostsResponseSchema,
  scheduleSocialPostsInputSchema,
  updateAutoPostAgentConfigInputSchema,
} from "@opsui/shared";
import type { AutoPostAgentConfig } from "@opsui/shared";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import { storage } from "../db/database.js";
import type {
  DbAutoPostAgentConfigRow,
  DbScheduledSocialPostRow,
  DbScheduledSocialPostStatus,
  DbSocialAccountRow,
} from "../types.js";
import { authenticateRequest, requireAdmin } from "./auth.js";
import {
  listConfiguredSocialAccounts,
  parseDataUrl,
  publishScheduledSocialPost,
} from "./social-publisher.js";
import type { DbScheduledSocialPostWithCreatorRow } from "../db/adapter.js";

const parseStoredRefreshToken = (
  metadataJson: string | undefined,
): string | null => {
  if (!metadataJson) {
    return null;
  }

  try {
    const metadata = JSON.parse(metadataJson) as { refreshToken?: unknown };
    return typeof metadata.refreshToken === "string" && metadata.refreshToken
      ? metadata.refreshToken
      : null;
  } catch {
    return null;
  }
};

const defaultAutoPostAgentConfig = (): AutoPostAgentConfig => ({
  enabled: false,
  cadence: {
    mode: "slots",
    slots: [
      { id: "default-slot", time: "09:00", days: [1, 2, 3, 4, 5], accountIds: [], postsPerRun: 1 },
    ],
  },
  imageStyle: "realistic",
  timezone: "Pacific/Auckland",
  lastRunAt: null,
  slotRuns: {},
  updatedByUserName: null,
  updatedAt: null,
});

const parseSlotRuns = (slotRunsJson: string): Record<string, string | null> => {
  try {
    const parsed = JSON.parse(slotRunsJson || "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string | null>;
    }
  } catch {
    /* fall through to empty */
  }
  return {};
};

const toAutoPostAgentConfig = (
  row: DbAutoPostAgentConfigRow | null,
): AutoPostAgentConfig => {
  if (!row) {
    return defaultAutoPostAgentConfig();
  }

  // Old {mode:"schedule"}/{mode:"rate"} rows fail the slots schema and degrade
  // to the default starter slot rather than crashing the endpoint.
  const cadence = autoPostAgentCadenceSchema.safeParse(
    JSON.parse(row.cadence_json || "{}"),
  );

  return autoPostAgentConfigSchema.parse({
    enabled: row.enabled === 1,
    cadence: cadence.success ? cadence.data : defaultAutoPostAgentConfig().cadence,
    imageStyle: row.image_style === "premium" ? "premium" : "realistic",
    timezone: row.timezone,
    lastRunAt: row.last_run_at,
    slotRuns: parseSlotRuns(row.slot_runs_json),
    updatedByUserName: null,
    updatedAt: row.updated_at,
  });
};

const toScheduledSocialPost = (row: DbScheduledSocialPostWithCreatorRow) =>
  scheduledSocialPostSchema.parse({
    id: row.id,
    platform: row.platform,
    accountId: row.account_id,
    caption: row.caption,
    imageName: row.image_name,
    thumbnailDataUrl: row.thumbnail_data_url,
    scheduledFor: row.scheduled_for,
    timezone: row.timezone,
    status: row.status,
    statusMessage: row.status_message,
    externalPostId: row.external_post_id,
    publishedAt: row.published_at,
    createdByUserId: row.created_by_user_id,
    createdByUserName: row.created_by_user_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

const scheduledPostsResponse = async () =>
  scheduledSocialPostsResponseSchema.parse({
    posts: (await storage.listScheduledSocialPosts()).map(toScheduledSocialPost),
    serverTime: new Date().toISOString(),
  });

const toSocialAccount = (
  account: Awaited<ReturnType<typeof listConfiguredSocialAccounts>>[number],
) =>
  socialAccountSchema.parse({
    id: account.id,
    platform: account.platform,
    displayName: account.displayName,
    accountId: account.accountId,
    connected: Boolean(account.accessToken),
    source: account.source,
    hasRefreshToken: Boolean(account.refreshToken),
    expiresAt: account.expiresAt,
    createdByUserId: account.createdByUserId,
    createdByUserName: account.createdByUserName,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  });

const socialAccountsResponse = async () =>
  socialAccountsResponseSchema.parse({
    accounts: (await listConfiguredSocialAccounts()).map(toSocialAccount),
    serverTime: new Date().toISOString(),
  });

const getRequestPublicBaseUrl = (request: import("fastify").FastifyRequest) => {
  if (env.socialPublicApiUrl) {
    return env.socialPublicApiUrl;
  }

  const forwardedProto = request.headers["x-forwarded-proto"];
  const forwardedHost = request.headers["x-forwarded-host"];
  const host = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : forwardedHost || request.headers.host;
  const protocol = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto || request.protocol;

  return host ? `${protocol}://${host}` : "";
};

export const processDueScheduledSocialPosts = async (publicBaseUrl = "") => {
  const duePosts = await storage.listDueScheduledSocialPosts(new Date().toISOString(), 10);

  for (const post of duePosts) {
    await storage.updateScheduledSocialPostStatus(post.id, "publishing", {
      statusMessage: "Publishing started.",
    });

    try {
      const result = await publishScheduledSocialPost(post, { publicBaseUrl });
      const status: DbScheduledSocialPostStatus = result.status;

      await storage.updateScheduledSocialPostStatus(post.id, status, {
        statusMessage: result.message,
        externalPostId: result.externalPostId ?? null,
        publishedAt: status === "published" ? new Date().toISOString() : null,
      });
    } catch (error) {
      await storage.updateScheduledSocialPostStatus(post.id, "failed", {
        statusMessage:
          error instanceof Error ? error.message : "Scheduled publish failed.",
      });
    }
  }
};

export const startSocialPostScheduler = (
  app: import("fastify").FastifyInstance,
) => {
  const run = () => {
    void processDueScheduledSocialPosts(env.socialPublicApiUrl).catch((error) => {
      app.log.error(error);
    });
  };
  const timer = setInterval(run, 60_000);

  run();

  app.addHook("onClose", (_instance, done) => {
    clearInterval(timer);
    done();
  });
};

export const registerSocialPostRoutes = (
  app: import("fastify").FastifyInstance,
) => {
  app.get(
    "/social-accounts",
    { preHandler: [authenticateRequest] },
    async () => socialAccountsResponse(),
  );

  app.post(
    "/social-accounts",
    { preHandler: [authenticateRequest, requireAdmin] },
    async (request, reply) => {
      if (!request.user) {
        return reply.unauthorized("Missing authenticated user");
      }

      const input = connectSocialAccountInputSchema.parse(request.body);
      const timestamp = new Date().toISOString();
      // Editing an existing account keeps its id; a new connection gets a fresh
      // id so multiple accounts can coexist on the same platform.
      const existing = input.id
        ? await storage.findSocialAccountById(input.id)
        : null;
      const existingRefreshToken = parseStoredRefreshToken(
        existing?.metadata_json,
      );
      // undefined -> keep existing refresh token; null -> clear; string -> set.
      const refreshToken =
        input.refreshToken !== undefined
          ? input.refreshToken
          : existingRefreshToken;
      const row: DbSocialAccountRow = {
        id: input.id ?? `${input.platform}-${nanoid()}`,
        platform: input.platform,
        display_name: input.displayName,
        account_id: input.accountId,
        access_token: input.accessToken,
        token_type: input.tokenType ?? "Bearer",
        expires_at: input.expiresAt ?? null,
        scopes: input.scopes ?? null,
        metadata_json: refreshToken
          ? JSON.stringify({ refreshToken })
          : "{}",
        active: 1,
        created_by_user_id: existing?.created_by_user_id ?? request.user.id,
        created_at: existing?.created_at ?? timestamp,
        updated_at: timestamp,
      };

      await storage.upsertSocialAccount(row);

      return socialAccountsResponse();
    },
  );

  app.delete(
    "/social-accounts/:id",
    { preHandler: [authenticateRequest, requireAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      if (id.startsWith("env-")) {
        return reply.badRequest(
          "This account is configured with environment variables. Remove it from the API environment instead.",
        );
      }

      await storage.deleteSocialAccount(id);

      return socialAccountsResponse();
    },
  );

  app.get("/social-posts/assets/:id/image", async (request, reply) => {
    const { id } = request.params as { id: string };
    const post = await storage.findScheduledSocialPostById(id);

    if (!post?.image_data_url) {
      return reply.notFound("Post image not found.");
    }

    const image = parseDataUrl(post.image_data_url);

    reply
      .header("Content-Type", image.mimeType)
      .header("Cache-Control", "public, max-age=86400");

    return reply.send(image.buffer);
  });

  app.get(
    "/social-posts",
    { preHandler: [authenticateRequest] },
    async () => scheduledPostsResponse(),
  );

  app.post(
    "/social-posts/schedule",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      if (!request.user) {
        return reply.unauthorized("Missing authenticated user");
      }

      const user = request.user;
      const input = scheduleSocialPostsInputSchema.parse(request.body);
      const scheduledDate = new Date(input.scheduledFor);

      if (scheduledDate.getTime() <= Date.now()) {
        return reply.badRequest("Choose a future go-live time.");
      }

      const createdAt = new Date().toISOString();
      const rows: DbScheduledSocialPostRow[] = input.posts.map((post) => ({
        id: `${post.platform}-${nanoid()}`,
        platform: post.platform,
        account_id: post.accountId ?? null,
        caption: post.caption.trim(),
        image_data_url: input.imageDataUrl ?? null,
        image_name: input.imageName ?? null,
        thumbnail_data_url: input.thumbnailDataUrl ?? input.imageDataUrl ?? null,
        scheduled_for: scheduledDate.toISOString(),
        timezone: input.timezone,
        status: "scheduled",
        status_message: "Waiting for scheduled publish time.",
        external_post_id: null,
        published_at: null,
        created_by_user_id: user.id,
        created_at: createdAt,
        updated_at: createdAt,
      }));

      await storage.insertScheduledSocialPosts(rows);

      return scheduledPostsResponse();
    },
  );

  app.post(
    "/social-posts/publish",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      if (!request.user) {
        return reply.unauthorized("Missing authenticated user");
      }

      const user = request.user;
      const input = publishSocialPostsInputSchema.parse(request.body);
      const createdAt = new Date().toISOString();
      const rows: DbScheduledSocialPostRow[] = input.posts.map((post) => ({
        id: `${post.platform}-${nanoid()}`,
        platform: post.platform,
        account_id: post.accountId ?? null,
        caption: post.caption.trim(),
        image_data_url: input.imageDataUrl ?? null,
        image_name: input.imageName ?? null,
        thumbnail_data_url: input.thumbnailDataUrl ?? input.imageDataUrl ?? null,
        scheduled_for: createdAt,
        timezone: input.timezone ?? "Local timezone",
        status: "publishing",
        status_message: "Publishing now.",
        external_post_id: null,
        published_at: null,
        created_by_user_id: user.id,
        created_at: createdAt,
        updated_at: createdAt,
      }));

      await storage.insertScheduledSocialPosts(rows);

      const publishedPosts: Array<ReturnType<typeof toScheduledSocialPost>> = [];

      for (const row of rows) {
        const post = await storage.findScheduledSocialPostById(row.id);

        if (!post) {
          continue;
        }

        try {
          const result = await publishScheduledSocialPost(post, {
            publicBaseUrl: getRequestPublicBaseUrl(request),
          });
          const status: DbScheduledSocialPostStatus = result.status;
          const updated = await storage.updateScheduledSocialPostStatus(post.id, status, {
            statusMessage: result.message,
            externalPostId: result.externalPostId ?? null,
            publishedAt: status === "published" ? new Date().toISOString() : null,
          });

          if (updated) {
            publishedPosts.push(toScheduledSocialPost(updated));
          }
        } catch (error) {
          const updated = await storage.updateScheduledSocialPostStatus(post.id, "failed", {
            statusMessage:
              error instanceof Error ? error.message : "Immediate publish failed.",
          });

          if (updated) {
            publishedPosts.push(toScheduledSocialPost(updated));
          }
        }
      }

      const response = await scheduledPostsResponse();

      return publishSocialPostsResponseSchema.parse({
        ...response,
        publishedPosts,
      });
    },
  );

  app.post(
    "/social-posts/process-due",
    { preHandler: [authenticateRequest, requireAdmin] },
    async (request) => {
      await processDueScheduledSocialPosts(getRequestPublicBaseUrl(request));
      return scheduledPostsResponse();
    },
  );

  app.post(
    "/social-posts/:id/reschedule",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const input = rescheduleSocialPostInputSchema.parse(request.body);
      const scheduledDate = new Date(input.scheduledFor);

      if (scheduledDate.getTime() <= Date.now()) {
        return reply.badRequest("Choose a future go-live time.");
      }

      const updated = await storage.rescheduleScheduledSocialPost(
        id,
        scheduledDate.toISOString(),
        input.timezone,
      );

      if (!updated) {
        return reply.notFound("Scheduled post not found or cannot be moved.");
      }

      return scheduledPostsResponse();
    },
  );

  app.post(
    "/social-posts/:id/delete",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const removed = await storage.deleteScheduledSocialPost(id);

      if (!removed) {
        return reply.notFound("Scheduled post not found or cannot be removed.");
      }

      return scheduledPostsResponse();
    },
  );

  // Approve or reject an auto-post agent draft (status 'pending_review').
  app.post(
    "/social-posts/:id/review",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      if (!request.user) {
        return reply.unauthorized("Missing authenticated user");
      }

      const { id } = request.params as { id: string };
      const input = reviewSocialPostInputSchema.parse(request.body);
      const post = await storage.findScheduledSocialPostById(id);

      if (!post || post.status !== "pending_review") {
        return reply.notFound("Pending review post not found.");
      }

      if (input.action === "reject") {
        await storage.deleteScheduledSocialPost(id);
        return scheduledPostsResponse();
      }

      if (input.publishNow) {
        await storage.updateScheduledSocialPostStatus(id, "publishing", {
          statusMessage: "Publishing now.",
        });
        const current = await storage.findScheduledSocialPostById(id);

        if (current) {
          try {
            const result = await publishScheduledSocialPost(current, {
              publicBaseUrl: getRequestPublicBaseUrl(request),
            });
            await storage.updateScheduledSocialPostStatus(id, result.status, {
              statusMessage: result.message,
              externalPostId: result.externalPostId ?? null,
              publishedAt:
                result.status === "published" ? new Date().toISOString() : null,
            });
          } catch (error) {
            await storage.updateScheduledSocialPostStatus(id, "failed", {
              statusMessage:
                error instanceof Error ? error.message : "Publish failed.",
            });
          }
        }

        return scheduledPostsResponse();
      }

      const requested = input.scheduledFor
        ? new Date(input.scheduledFor)
        : new Date(post.scheduled_for);
      const scheduledFor =
        requested.getTime() > Date.now()
          ? requested.toISOString()
          : new Date(Date.now() + 60_000).toISOString();

      await storage.approvePendingSocialPost(
        id,
        scheduledFor,
        input.timezone ?? post.timezone,
      );

      return scheduledPostsResponse();
    },
  );

  // Bulk approve/reject pending_review drafts in one call.
  app.post(
    "/social-posts/review-bulk",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      if (!request.user) {
        return reply.unauthorized("Missing authenticated user");
      }

      const input = bulkReviewSocialPostsInputSchema.parse(request.body);

      for (const id of input.ids) {
        const post = await storage.findScheduledSocialPostById(id);

        if (!post || post.status !== "pending_review") {
          continue;
        }

        if (input.action === "reject") {
          await storage.deleteScheduledSocialPost(id);
          continue;
        }

        const requested = new Date(post.scheduled_for);
        const scheduledFor =
          requested.getTime() > Date.now()
            ? requested.toISOString()
            : new Date(Date.now() + 60_000).toISOString();
        await storage.approvePendingSocialPost(id, scheduledFor, post.timezone);
      }

      return scheduledPostsResponse();
    },
  );

  // Inline-edit a draft/scheduled post's caption.
  app.post(
    "/social-posts/:id/caption",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const input = editScheduledPostCaptionInputSchema.parse(request.body);
      const trimmed = input.caption.trim();
      const existing = await storage.findScheduledSocialPostById(id);

      if (!existing) {
        return reply.notFound("Post not found.");
      }

      // Mirror the create-time invariant: a post needs a caption or an image.
      if (!trimmed && !existing.image_data_url) {
        return reply.badRequest("Add a caption — this post has no image.");
      }

      const updated = await storage.updateScheduledSocialPostCaption(id, trimmed);

      if (!updated) {
        return reply.notFound("Post not found or its caption can't be edited.");
      }

      return scheduledPostsResponse();
    },
  );

  // Publish an already-scheduled post immediately.
  app.post(
    "/social-posts/:id/publish-now",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const post = await storage.findScheduledSocialPostById(id);

      if (
        !post ||
        !["scheduled", "failed", "connection_required"].includes(post.status)
      ) {
        return reply.notFound("Post not found or can't be published now.");
      }

      await storage.updateScheduledSocialPostStatus(id, "publishing", {
        statusMessage: "Publishing now.",
      });
      const current = await storage.findScheduledSocialPostById(id);
      const publishedPosts: Array<ReturnType<typeof toScheduledSocialPost>> = [];

      if (current) {
        try {
          const result = await publishScheduledSocialPost(current, {
            publicBaseUrl: getRequestPublicBaseUrl(request),
          });
          const updated = await storage.updateScheduledSocialPostStatus(id, result.status, {
            statusMessage: result.message,
            externalPostId: result.externalPostId ?? null,
            publishedAt:
              result.status === "published" ? new Date().toISOString() : null,
          });
          if (updated) {
            publishedPosts.push(toScheduledSocialPost(updated));
          }
        } catch (error) {
          const updated = await storage.updateScheduledSocialPostStatus(id, "failed", {
            statusMessage: error instanceof Error ? error.message : "Publish failed.",
          });
          if (updated) {
            publishedPosts.push(toScheduledSocialPost(updated));
          }
        }
      }

      const response = await scheduledPostsResponse();

      return publishSocialPostsResponseSchema.parse({ ...response, publishedPosts });
    },
  );

  // Clone a post (incl. its image) into a new scheduled draft.
  app.post(
    "/social-posts/:id/duplicate",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      if (!request.user) {
        return reply.unauthorized("Missing authenticated user");
      }

      const { id } = request.params as { id: string };
      const input = duplicateScheduledPostInputSchema.parse(request.body);
      const scheduledDate = new Date(input.scheduledFor);

      if (scheduledDate.getTime() <= Date.now()) {
        return reply.badRequest("Choose a future go-live time.");
      }

      const source = await storage.findScheduledSocialPostById(id);

      if (!source) {
        return reply.notFound("Post not found.");
      }

      if (source.status === "cancelled") {
        return reply.badRequest("Cancelled posts can't be duplicated.");
      }

      // A review-queue draft clones back into the review queue so it can't skip
      // approval; anything else clones into a normal scheduled post.
      const isDraft = source.status === "pending_review";
      const createdAt = new Date().toISOString();
      await storage.insertScheduledSocialPosts([
        {
          id: `${source.platform}-${nanoid()}`,
          platform: source.platform,
          account_id: source.account_id,
          caption: source.caption,
          image_data_url: source.image_data_url,
          image_name: source.image_name,
          thumbnail_data_url: source.thumbnail_data_url,
          scheduled_for: scheduledDate.toISOString(),
          timezone: input.timezone,
          status: isDraft ? "pending_review" : "scheduled",
          status_message: isDraft
            ? "Duplicated draft awaiting review."
            : "Waiting for scheduled publish time.",
          external_post_id: null,
          published_at: null,
          created_by_user_id: request.user.id,
          created_at: createdAt,
          updated_at: createdAt,
        },
      ]);

      return scheduledPostsResponse();
    },
  );

  app.get(
    "/social-posts/agent-config",
    { preHandler: [authenticateRequest] },
    async () => {
      const row = await storage.getAutoPostAgentConfig();

      return autoPostAgentConfigResponseSchema.parse({
        config: toAutoPostAgentConfig(row),
        serverTime: new Date().toISOString(),
      });
    },
  );

  app.post(
    "/social-posts/agent-config",
    { preHandler: [authenticateRequest, requireAdmin] },
    async (request, reply) => {
      if (!request.user) {
        return reply.unauthorized("Missing authenticated user");
      }

      const input = updateAutoPostAgentConfigInputSchema.parse(request.body);
      const existing = await storage.getAutoPostAgentConfig();
      const now = new Date().toISOString();

      // Ensure every slot carries a stable id so its slot_runs entry survives
      // edits/reordering (the schema requires one, but normalize defensively).
      const normalizedCadence = {
        mode: "slots" as const,
        slots: input.cadence.slots.map((slot) => ({
          ...slot,
          id: slot.id.trim() || nanoid(),
        })),
      };

      // Prune the per-slot run clock to the surviving slot ids so the blob can't
      // accumulate orphaned entries as slots are renamed/removed over time.
      const currentSlotIds = new Set(normalizedCadence.slots.map((slot) => slot.id));
      const prunedSlotRuns = Object.fromEntries(
        Object.entries(parseSlotRuns(existing?.slot_runs_json ?? "{}")).filter(
          ([slotId]) => currentSlotIds.has(slotId),
        ),
      );

      await storage.upsertAutoPostAgentConfig({
        id: "default",
        enabled: input.enabled ? 1 : 0,
        cadence_json: JSON.stringify(normalizedCadence),
        // Vestigial columns since the per-slot redesign.
        posts_per_run: 1,
        target_account_ids_json: "[]",
        image_style: input.imageStyle,
        timezone: input.timezone,
        // Keep the run clock on re-enable so we don't immediately re-fire the
        // current slot; clear both clocks when disabling.
        last_run_at: input.enabled ? existing?.last_run_at ?? null : null,
        slot_runs_json: input.enabled ? JSON.stringify(prunedSlotRuns) : "{}",
        updated_by_user_id: request.user.id,
        updated_at: now,
      });

      const row = await storage.getAutoPostAgentConfig();

      return autoPostAgentConfigResponseSchema.parse({
        config: toAutoPostAgentConfig(row),
        serverTime: new Date().toISOString(),
      });
    },
  );
};

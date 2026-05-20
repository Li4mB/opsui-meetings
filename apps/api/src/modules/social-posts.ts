import {
  connectSocialAccountInputSchema,
  publishSocialPostsInputSchema,
  publishSocialPostsResponseSchema,
  rescheduleSocialPostInputSchema,
  socialAccountSchema,
  socialAccountsResponseSchema,
  scheduledSocialPostSchema,
  scheduledSocialPostsResponseSchema,
  scheduleSocialPostsInputSchema,
} from "@opsui/shared";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import { storage } from "../db/database.js";
import type {
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

const toScheduledSocialPost = (row: DbScheduledSocialPostWithCreatorRow) =>
  scheduledSocialPostSchema.parse({
    id: row.id,
    platform: row.platform,
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
      const row: DbSocialAccountRow = {
        id: `${input.platform}-${nanoid()}`,
        platform: input.platform,
        display_name: input.displayName,
        account_id: input.accountId,
        access_token: input.accessToken,
        token_type: input.tokenType ?? "Bearer",
        expires_at: input.expiresAt ?? null,
        scopes: input.scopes ?? null,
        metadata_json: "{}",
        active: 1,
        created_by_user_id: request.user.id,
        created_at: timestamp,
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
};

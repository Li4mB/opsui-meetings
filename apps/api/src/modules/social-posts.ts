import {
  scheduledSocialPostSchema,
  scheduledSocialPostsResponseSchema,
  scheduleSocialPostsInputSchema,
} from "@opsui/shared";
import { nanoid } from "nanoid";
import { storage } from "../db/database.js";
import type {
  DbScheduledSocialPostRow,
  DbScheduledSocialPostStatus,
} from "../types.js";
import { authenticateRequest, requireAdmin } from "./auth.js";
import { publishScheduledSocialPost } from "./social-publisher.js";
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

export const processDueScheduledSocialPosts = async () => {
  const duePosts = await storage.listDueScheduledSocialPosts(new Date().toISOString(), 10);

  for (const post of duePosts) {
    await storage.updateScheduledSocialPostStatus(post.id, "publishing", {
      statusMessage: "Publishing started.",
    });

    try {
      const result = await publishScheduledSocialPost(post);
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
    void processDueScheduledSocialPosts().catch((error) => {
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
    "/social-posts/process-due",
    { preHandler: [authenticateRequest, requireAdmin] },
    async () => {
      await processDueScheduledSocialPosts();
      return scheduledPostsResponse();
    },
  );
};

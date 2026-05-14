import { z } from "zod";

export const scheduledSocialPlatformSchema = z.enum([
  "facebook",
  "linkedin",
  "twitter",
  "instagram",
]);

export const scheduledSocialPostStatusSchema = z.enum([
  "scheduled",
  "publishing",
  "published",
  "failed",
  "connection_required",
  "cancelled",
]);

const scheduleSocialPostDraftSchema = z.object({
  platform: scheduledSocialPlatformSchema,
  caption: z.string().max(4000).default(""),
});

export const scheduleSocialPostsInputSchema = z
  .object({
    posts: z.array(scheduleSocialPostDraftSchema).min(1).max(4),
    imageDataUrl: z.string().max(12_000_000).nullable().optional(),
    imageName: z.string().max(240).nullable().optional(),
    thumbnailDataUrl: z.string().max(750_000).nullable().optional(),
    scheduledFor: z.string().datetime(),
    timezone: z.string().min(1).max(120),
  })
  .refine(
    (input) =>
      input.posts.some((post) => post.caption.trim().length > 0) ||
      Boolean(input.imageDataUrl),
    "Add a caption or image before scheduling.",
  );

export const scheduledSocialPostSchema = z.object({
  id: z.string(),
  platform: scheduledSocialPlatformSchema,
  caption: z.string(),
  imageName: z.string().nullable(),
  thumbnailDataUrl: z.string().nullable(),
  scheduledFor: z.string(),
  timezone: z.string(),
  status: scheduledSocialPostStatusSchema,
  statusMessage: z.string().nullable(),
  externalPostId: z.string().nullable(),
  publishedAt: z.string().nullable(),
  createdByUserId: z.string(),
  createdByUserName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const scheduledSocialPostsResponseSchema = z.object({
  posts: z.array(scheduledSocialPostSchema),
  serverTime: z.string(),
});

export type ScheduledSocialPlatform = z.infer<typeof scheduledSocialPlatformSchema>;
export type ScheduledSocialPostStatus = z.infer<typeof scheduledSocialPostStatusSchema>;
export type ScheduleSocialPostsInput = z.infer<typeof scheduleSocialPostsInputSchema>;
export type ScheduledSocialPost = z.infer<typeof scheduledSocialPostSchema>;

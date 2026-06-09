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
  // The auto-post agent writes drafts in this status; nothing publishes until a
  // human approves (the publish scheduler only ever selects "scheduled").
  "pending_review",
]);

const scheduleSocialPostDraftSchema = z.object({
  platform: scheduledSocialPlatformSchema,
  accountId: z.string().trim().min(1).max(240).optional(),
  caption: z.string().max(4000).default(""),
});

const hasPostContent = (input: {
  posts: Array<{ caption: string }>;
  imageDataUrl?: string | null;
}) =>
  input.posts.some((post) => post.caption.trim().length > 0) ||
  Boolean(input.imageDataUrl);

export const scheduleSocialPostsInputSchema = z
  .object({
    posts: z.array(scheduleSocialPostDraftSchema).min(1).max(4),
    imageDataUrl: z.string().max(12_000_000).nullable().optional(),
    imageName: z.string().max(240).nullable().optional(),
    thumbnailDataUrl: z.string().max(750_000).nullable().optional(),
    scheduledFor: z.string().datetime(),
    timezone: z.string().min(1).max(120),
  })
  .refine(hasPostContent, "Add a caption or image before scheduling.");

export const publishSocialPostsInputSchema = z
  .object({
    posts: z.array(scheduleSocialPostDraftSchema).min(1).max(4),
    imageDataUrl: z.string().max(12_000_000).nullable().optional(),
    imageName: z.string().max(240).nullable().optional(),
    thumbnailDataUrl: z.string().max(750_000).nullable().optional(),
    timezone: z.string().min(1).max(120).optional(),
  })
  .refine(hasPostContent, "Add a caption or image before publishing.");

export const rescheduleSocialPostInputSchema = z.object({
  scheduledFor: z.string().datetime(),
  timezone: z.string().min(1).max(120),
});

export const scheduledSocialPostSchema = z.object({
  id: z.string(),
  platform: scheduledSocialPlatformSchema,
  accountId: z.string().nullable(),
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

export const publishSocialPostsResponseSchema = scheduledSocialPostsResponseSchema.extend({
  publishedPosts: z.array(scheduledSocialPostSchema),
});

export const socialAccountSourceSchema = z.enum(["database", "environment"]);

export const socialAccountSchema = z.object({
  id: z.string(),
  platform: scheduledSocialPlatformSchema,
  displayName: z.string(),
  accountId: z.string(),
  connected: z.boolean(),
  source: socialAccountSourceSchema,
  hasRefreshToken: z.boolean(),
  expiresAt: z.string().nullable(),
  createdByUserId: z.string().nullable(),
  createdByUserName: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const socialAccountsResponseSchema = z.object({
  accounts: z.array(socialAccountSchema),
  serverTime: z.string(),
});

export const connectSocialAccountInputSchema = z.object({
  id: z.string().trim().min(1).max(240).optional(),
  platform: scheduledSocialPlatformSchema,
  displayName: z.string().trim().min(1).max(120),
  accountId: z.string().trim().min(1).max(240),
  accessToken: z.string().trim().min(1).max(8000),
  refreshToken: z.string().trim().max(8000).nullable().optional(),
  tokenType: z.string().trim().max(80).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  scopes: z.string().trim().max(1000).nullable().optional(),
});

// ---- Auto-post agent (review-queue) ----
export const autoPostAgentCadenceSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("schedule"),
    // "HH:MM" 24h local times + ISO weekday numbers (0=Sun..6=Sat).
    times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1).max(8),
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  }),
  z.object({
    mode: z.literal("rate"),
    perDay: z.number().int().min(1).max(8),
  }),
]);

export const autoPostAgentConfigSchema = z.object({
  enabled: z.boolean(),
  cadence: autoPostAgentCadenceSchema,
  postsPerRun: z.number().int().min(1).max(4),
  targetAccountIds: z.array(z.string().min(1).max(240)).max(12),
  imageStyle: z.enum(["realistic", "premium"]),
  timezone: z.string().min(1).max(120),
  lastRunAt: z.string().nullable(),
  updatedByUserName: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const updateAutoPostAgentConfigInputSchema = z.object({
  enabled: z.boolean(),
  cadence: autoPostAgentCadenceSchema,
  postsPerRun: z.number().int().min(1).max(4),
  targetAccountIds: z.array(z.string().min(1).max(240)).max(12),
  imageStyle: z.enum(["realistic", "premium"]),
  timezone: z.string().min(1).max(120),
});

export const autoPostAgentConfigResponseSchema = z.object({
  config: autoPostAgentConfigSchema,
  serverTime: z.string(),
});

export const reviewSocialPostInputSchema = z.object({
  action: z.enum(["approve", "reject"]),
  publishNow: z.boolean().optional(),
  scheduledFor: z.string().datetime().optional(),
  timezone: z.string().min(1).max(120).optional(),
});

export type ScheduledSocialPlatform = z.infer<typeof scheduledSocialPlatformSchema>;
export type ScheduledSocialPostStatus = z.infer<typeof scheduledSocialPostStatusSchema>;
export type ScheduleSocialPostsInput = z.infer<typeof scheduleSocialPostsInputSchema>;
export type RescheduleSocialPostInput = z.infer<typeof rescheduleSocialPostInputSchema>;
export type PublishSocialPostsInput = z.infer<typeof publishSocialPostsInputSchema>;
export type ScheduledSocialPost = z.infer<typeof scheduledSocialPostSchema>;
export type PublishSocialPostsResponse = z.infer<typeof publishSocialPostsResponseSchema>;
export type SocialAccount = z.infer<typeof socialAccountSchema>;
export type SocialAccountsResponse = z.infer<typeof socialAccountsResponseSchema>;
export type ConnectSocialAccountInput = z.infer<typeof connectSocialAccountInputSchema>;
export type AutoPostAgentCadence = z.infer<typeof autoPostAgentCadenceSchema>;
export type AutoPostAgentConfig = z.infer<typeof autoPostAgentConfigSchema>;
export type UpdateAutoPostAgentConfigInput = z.infer<typeof updateAutoPostAgentConfigInputSchema>;
export type ReviewSocialPostInput = z.infer<typeof reviewSocialPostInputSchema>;

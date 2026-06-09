import { z } from "zod";

export const aiGuideModuleSchema = z.object({
  module: z.string(),
  reason: z.string(),
});

export const aiGuideObjectionSchema = z.object({
  objection: z.string(),
  guidance: z.string(),
});

export const aiGuideStepSchema = z.object({
  step: z.string(),
  guidance: z.string(),
});

export const aiMeetingGuideContentSchema = z.object({
  meetingSummary: z.string(),
  recommendedOpening: z.string(),
  discoveryQuestions: z.array(z.string()).min(3).max(8),
  recommendedModules: z.array(aiGuideModuleSchema).max(6),
  objectionHandling: z.array(aiGuideObjectionSchema).max(6),
  talkTrackSteps: z.array(aiGuideStepSchema).min(3).max(8),
  closeStrategy: z.string(),
  sourceContext: z.array(z.string()).max(8),
});

export const aiMeetingGuideSchema = aiMeetingGuideContentSchema.extend({
  generatedAt: z.string(),
  model: z.string(),
});

export const aiMeetingGuideRequestSchema = z.object({
  meetingId: z.string(),
});

export const aiMeetingGuideBindingSchema = z.object({
  guide: aiMeetingGuideSchema.nullable(),
  locked: z.boolean(),
});

export const socialPlatformSchema = z.enum([
  "general",
  "facebook",
  "linkedin",
  "twitter",
  "instagram",
]);

export const aiPostContentRequestSchema = z.object({
  prompt: z.string().min(1).max(8000),
  platform: socialPlatformSchema.default("general"),
  currentCaption: z.string().max(4000).optional(),
  tweakInstruction: z.string().max(2000).optional(),
  imageNames: z.array(z.string()).max(6).default([]),
  tags: z.array(z.string()).max(12).default([]),
});

export const aiPostContentSchema = z.object({
  caption: z.string().min(1).max(4000),
  alternatives: z.array(z.string().min(1).max(4000)).min(3).max(3),
  hashtagBank: z.array(z.string().min(1).max(64)).min(1).max(24),
  postingStyleRecommendation: z.string().min(1).max(1200),
  ctaOptions: z.array(z.string().min(1).max(220)).min(1).max(8),
  generatedAt: z.string(),
  model: z.string(),
});

export const aiPostImageStyleSchema = z.enum(["realistic", "premium"]);

export const aiPostImageRequestSchema = z.object({
  prompt: z.string().min(1).max(8000),
  caption: z.string().max(2200).optional(),
  tags: z.array(z.string()).max(12).default([]),
  conversationId: z.string().trim().min(1).max(160).optional(),
  style: aiPostImageStyleSchema.default("realistic"),
});

export const aiPostImageSchema = z.object({
  imageDataUrl: z.string().min(1),
  fileName: z.string().min(1),
  conversationId: z.string().min(1),
  tags: z.array(z.string()).max(12),
  generatedAt: z.string(),
  model: z.string(),
});

// ---- Post history (context for the assistant + the History drawer) ----
export const aiPostHistoryItemSchema = z.object({
  kind: z.enum(["published", "caption", "image"]),
  id: z.string(),
  createdAt: z.string(),
  platform: z.string().nullable(),
  caption: z.string().nullable(),
  prompt: z.string().nullable(),
  imageName: z.string().nullable(),
  thumbnailDataUrl: z.string().nullable(),
  model: z.string().nullable(),
});

export const aiPostHistoryResponseSchema = z.object({
  items: z.array(aiPostHistoryItemSchema),
  serverTime: z.string(),
});

// ---- "Plan my next post" (the planner brain, shared by the button + the agent) ----
export const aiPostPlanFrameworkSchema = z.enum([
  "hook-retention-cta",
  "AIDA",
  "PAS",
  "BAB",
  "education",
  "social-proof",
  "contrarian",
]);

export const aiPostPlanValueRatioSchema = z.enum(["value", "soft-promo", "promo"]);

export const aiPlanPostRequestSchema = z.object({
  targetAccountIds: z.array(z.string().min(1).max(240)).max(12).default([]),
  guidance: z.string().max(600).optional(),
  conversationId: z.string().trim().min(1).max(160).optional(),
  timezone: z.string().min(1).max(120).optional(),
  nowIso: z.string().datetime().optional(),
});

export const aiPlanAccountTargetSchema = z.object({
  accountId: z.string().min(1).max(240),
  displayName: z.string().min(1).max(120),
  captionTweak: z.string().max(4000).nullable(),
  reason: z.string().min(1).max(400),
});

export const aiPlanSuggestedTimeSchema = z.object({
  isoTime: z.string().nullable(),
  slotLabel: z.string().min(1).max(120),
  cadenceNote: z.string().max(280),
  reason: z.string().min(1).max(400),
});

// The model-filled content (parsed via zodTextFormat).
export const aiPostPlanContentSchema = z.object({
  contentPillar: z.string().min(1).max(120),
  angle: z.string().min(1).max(240),
  framework: aiPostPlanFrameworkSchema,
  rationale: z.string().min(1).max(1200),
  repetitionCheck: z.string().min(1).max(600),
  valueVsPromo: aiPostPlanValueRatioSchema,
  caption: z.string().min(1).max(4000),
  alternatives: z.array(z.string().min(1).max(4000)).min(3).max(3),
  hashtagBank: z.array(z.string().min(1).max(64)).min(1).max(24),
  ctaOptions: z.array(z.string().min(1).max(220)).min(1).max(6),
  imagePrompt: z.string().min(1).max(2000),
  imageStyle: aiPostImageStyleSchema,
  imageRationale: z.string().min(1).max(400),
  recommendedAccounts: z.array(aiPlanAccountTargetSchema).min(1).max(12),
  suggestedPostTime: aiPlanSuggestedTimeSchema,
});

export const aiPostPlanSchema = aiPostPlanContentSchema.extend({
  generatedAt: z.string(),
  model: z.string(),
});

// ---- Strategy chat assistant ----
export const aiChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});

export const aiPostChatRequestSchema = z.object({
  messages: z.array(aiChatMessageSchema).min(1).max(40),
  conversationId: z.string().trim().min(1).max(160).optional(),
});

export const aiPostChatContentSchema = z.object({
  reply: z.string().min(1).max(6000),
  handoff: z.object({
    action: z.enum(["draft_post", "none"]),
    seedGuidance: z.string().max(600).nullable(),
  }),
});

export const aiPostChatResponseSchema = aiPostChatContentSchema.extend({
  generatedAt: z.string(),
  model: z.string(),
});

export type AiMeetingGuide = z.infer<typeof aiMeetingGuideSchema>;
export type AiMeetingGuideRequest = z.infer<typeof aiMeetingGuideRequestSchema>;
export type AiMeetingGuideBinding = z.infer<typeof aiMeetingGuideBindingSchema>;
export type AiPostContent = z.infer<typeof aiPostContentSchema>;
export type AiPostContentRequest = z.infer<typeof aiPostContentRequestSchema>;
export type AiPostImage = z.infer<typeof aiPostImageSchema>;
export type AiPostImageRequest = z.infer<typeof aiPostImageRequestSchema>;
export type AiPostImageStyle = z.infer<typeof aiPostImageStyleSchema>;
export type AiPostHistoryItem = z.infer<typeof aiPostHistoryItemSchema>;
export type AiPostHistoryResponse = z.infer<typeof aiPostHistoryResponseSchema>;
export type AiPlanPostRequest = z.infer<typeof aiPlanPostRequestSchema>;
export type AiPostPlan = z.infer<typeof aiPostPlanSchema>;
export type AiPostChatRequest = z.infer<typeof aiPostChatRequestSchema>;
export type AiPostChatResponse = z.infer<typeof aiPostChatResponseSchema>;
export type AiChatMessage = z.infer<typeof aiChatMessageSchema>;

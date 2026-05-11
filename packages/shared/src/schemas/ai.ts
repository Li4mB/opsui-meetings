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

export const aiPostContentRequestSchema = z.object({
  prompt: z.string().min(1).max(8000),
  currentCaption: z.string().max(2200).optional(),
  imageNames: z.array(z.string()).max(6).default([]),
  tags: z.array(z.string()).max(12).default([]),
});

export const aiPostContentSchema = z.object({
  caption: z.string().min(1).max(2200),
  tags: z.array(z.string()).min(1).max(12),
  generatedAt: z.string(),
  model: z.string(),
});

export const aiPostImageRequestSchema = z.object({
  prompt: z.string().min(1).max(8000),
  caption: z.string().max(2200).optional(),
  tags: z.array(z.string()).max(12).default([]),
});

export const aiPostImageSchema = z.object({
  imageDataUrl: z.string().min(1),
  fileName: z.string().min(1),
  tags: z.array(z.string()).max(12),
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

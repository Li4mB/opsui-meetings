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

export type AiMeetingGuide = z.infer<typeof aiMeetingGuideSchema>;
export type AiMeetingGuideRequest = z.infer<typeof aiMeetingGuideRequestSchema>;
export type AiMeetingGuideBinding = z.infer<typeof aiMeetingGuideBindingSchema>;

import { z } from "zod";

export const callingProspectStatusOptions = [
  "new",
  "queued",
  "calling",
  "completed",
  "failed",
  "do_not_call",
] as const;

export const callingBatchStatusOptions = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export const callingCallStatusOptions = [
  "queued",
  "calling",
  "completed",
  "failed",
  "skipped",
  "cancelled",
] as const;

export const callingCallOutcomeOptions = [
  "completed",
  "no_answer",
  "voicemail",
  "busy",
  "failed",
  "follow_up",
  "not_interested",
] as const;

export const callingExternalCallStatusOptions = [
  "queued",
  "ringing",
  "in_progress",
  "ended",
  "failed",
] as const;

export const callingTranscriptRoleOptions = ["assistant", "customer"] as const;

export const callingProspectStatusSchema = z.enum(
  callingProspectStatusOptions,
);
export const callingBatchStatusSchema = z.enum(callingBatchStatusOptions);
export const callingCallStatusSchema = z.enum(callingCallStatusOptions);
export const callingCallOutcomeSchema = z.enum(callingCallOutcomeOptions);
export const callingExternalCallStatusSchema = z.enum(
  callingExternalCallStatusOptions,
);
export const callingTranscriptRoleSchema = z.enum(callingTranscriptRoleOptions);

export const callingProspectSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  companyName: z.string(),
  email: z.string().nullable(),
  notes: z.string(),
  source: z.enum(["manual", "google_sheet"]),
  externalId: z.string().nullable(),
  status: callingProspectStatusSchema,
  lastCallAt: z.string().nullable(),
  lastCallOutcome: z.string().nullable(),
  createdByUserId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const callingBatchSchema = z.object({
  id: z.string(),
  status: callingBatchStatusSchema,
  totalCount: z.number().int().nonnegative(),
  createdByUserId: z.string(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export const callingCallSchema = z.object({
  id: z.string(),
  batchId: z.string(),
  prospectId: z.string(),
  sequenceIndex: z.number().int().nonnegative(),
  status: callingCallStatusSchema,
  outcome: z.string().nullable(),
  notes: z.string(),
  durationSeconds: z.number().int().nonnegative().nullable(),
  externalCallId: z.string().nullable(),
  statusMessage: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  updatedAt: z.string(),
});

export const callingTranscriptTurnSchema = z.object({
  id: z.string(),
  vapiCallId: z.string(),
  eventKey: z.string(),
  role: callingTranscriptRoleSchema,
  transcript: z.string(),
  occurredAt: z.string(),
  sequenceIndex: z.number().int().nonnegative(),
  createdAt: z.string(),
});

export const callingExternalCallSchema = z.object({
  vapiCallId: z.string(),
  source: z.string(),
  leadExternalId: z.string().nullable(),
  leadName: z.string(),
  companyName: z.string(),
  phone: z.string(),
  context: z.record(z.string(), z.unknown()),
  status: callingExternalCallStatusSchema,
  outcome: z.string().nullable(),
  summary: z.string().nullable(),
  report: z.record(z.string(), z.unknown()).nullable(),
  partialRole: callingTranscriptRoleSchema.nullable(),
  partialTranscript: z.string().nullable(),
  partialUpdatedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  transcriptTurns: z.array(callingTranscriptTurnSchema),
});

export const vapiServerEventSchema = z.object({
  message: z.object({
    type: z.string().min(1),
    call: z.object({
      id: z.string().min(1),
      status: z.string().optional(),
      createdAt: z.string().optional(),
      startedAt: z.string().optional(),
      endedAt: z.string().optional(),
      endedReason: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      customer: z.object({ number: z.string().optional() }).passthrough().optional(),
    }).passthrough(),
    role: z.string().optional(),
    transcriptType: z.string().optional(),
    transcript: z.string().optional(),
    turn: z.number().int().nonnegative().optional(),
    eventId: z.string().optional(),
    timestamp: z.union([z.string(), z.number()]).optional(),
    artifact: z.record(z.string(), z.unknown()).optional(),
    analysis: z.record(z.string(), z.unknown()).optional(),
    endedReason: z.string().optional(),
  }).passthrough(),
});

export const callingSheetSourceSchema = z.object({
  id: z.string(),
  spreadsheetId: z.string(),
  label: z.string(),
  createdByUserId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createCallingProspectInputSchema = z.object({
  name: z.string().min(2).max(100),
  phone: z.string().min(6).max(40),
  companyName: z.string().min(2).max(140),
  email: z.string().email().nullable().optional(),
  notes: z.string().max(2000).default(""),
});

export const createCallingBatchInputSchema = z.object({
  prospectIds: z.array(z.string().min(1)).min(1).max(100),
});

export const callingTestModeSchema = z.enum(["phone", "mr_tester"]);

export const createCallingTestCallInputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("phone"),
    phone: z.string().trim().min(6).max(40),
  }),
  z.object({
    mode: z.literal("mr_tester"),
    testCase: z.string().trim().min(3).max(4000),
  }),
]);

export const createCallingSheetSourceInputSchema = z.object({
  urlOrId: z.string().min(20).max(500),
  label: z.string().max(120).optional(),
});

export const callingCallCompletionInputSchema = z.object({
  secret: z.string().optional(),
  status: z.enum(["completed", "failed"]).default("completed"),
  outcome: callingCallOutcomeSchema.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  durationSeconds: z.number().int().nonnegative().max(24 * 60 * 60).nullable().optional(),
  externalCallId: z.string().max(200).nullable().optional(),
  makeExecutionId: z.string().max(200).nullable().optional(),
});

export const callingWorkspaceResponseSchema = z.object({
  prospects: z.array(callingProspectSchema),
  batches: z.array(callingBatchSchema),
  calls: z.array(callingCallSchema),
  externalCalls: z.array(callingExternalCallSchema),
  sheetSources: z.array(callingSheetSourceSchema),
  webhookConfigured: z.boolean(),
  vapiEventsConfigured: z.boolean(),
  sheetConfigured: z.boolean(),
  lastSheetSyncAt: z.string().nullable(),
});

export const callingBatchStartResponseSchema = z.object({
  batch: callingBatchSchema,
  calls: z.array(callingCallSchema),
  startedCallId: z.string().nullable(),
});

export const callingProspectsSyncResponseSchema = z.object({
  imported: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  syncedAt: z.string(),
});

export type CallingProspectStatus = z.infer<typeof callingProspectStatusSchema>;
export type CallingBatchStatus = z.infer<typeof callingBatchStatusSchema>;
export type CallingCallStatus = z.infer<typeof callingCallStatusSchema>;
export type CallingCallOutcome = z.infer<typeof callingCallOutcomeSchema>;
export type CallingExternalCallStatus = z.infer<
  typeof callingExternalCallStatusSchema
>;
export type CallingTranscriptRole = z.infer<typeof callingTranscriptRoleSchema>;
export type CallingProspect = z.infer<typeof callingProspectSchema>;
export type CallingBatch = z.infer<typeof callingBatchSchema>;
export type CallingCall = z.infer<typeof callingCallSchema>;
export type CallingExternalCall = z.infer<typeof callingExternalCallSchema>;
export type CallingTranscriptTurn = z.infer<typeof callingTranscriptTurnSchema>;
export type VapiServerEvent = z.infer<typeof vapiServerEventSchema>;
export type CallingSheetSource = z.infer<typeof callingSheetSourceSchema>;
export type CreateCallingProspectInput = z.infer<
  typeof createCallingProspectInputSchema
>;
export type CreateCallingBatchInput = z.infer<
  typeof createCallingBatchInputSchema
>;
export type CallingTestMode = z.infer<typeof callingTestModeSchema>;
export type CreateCallingTestCallInput = z.infer<
  typeof createCallingTestCallInputSchema
>;
export type CreateCallingSheetSourceInput = z.infer<
  typeof createCallingSheetSourceInputSchema
>;
export type CallingCallCompletionInput = z.infer<
  typeof callingCallCompletionInputSchema
>;
export type CallingWorkspaceResponse = z.infer<
  typeof callingWorkspaceResponseSchema
>;
export type CallingBatchStartResponse = z.infer<
  typeof callingBatchStartResponseSchema
>;
export type CallingProspectsSyncResponse = z.infer<
  typeof callingProspectsSyncResponseSchema
>;

import { z } from "zod";

export const countrySchema = z.enum(["Australia", "NZ", "Unknown"]);

export const meetingSchema = z.object({
  id: z.string(),
  googleEventId: z.string(),
  title: z.string(),
  clientName: z.string(),
  company: z.string(),
  country: countrySchema,
  meetingType: z.string(),
  startAtUtc: z.string(),
  endAtUtc: z.string(),
  sourceTimezone: z.string(),
  googleMeetUrl: z.string().nullable(),
  googleDocUrl: z.string().nullable(),
  clientEmail: z.string().nullable(),
  phone: z.string().nullable(),
  companySize: z.string().nullable(),
  modulesOfInterest: z.array(z.string()),
  descriptionRaw: z.string(),
  calendarHtmlUrl: z.string().nullable(),
  assignedUserId: z.string().nullable(),
  assignedUserName: z.string().nullable(),
  assignedUserColor: z.string().nullable(),
  updatedAt: z.string(),
  lastSyncedAt: z.string(),
});

export const meetingsResponseSchema = z.object({
  meetings: z.array(meetingSchema),
  lastSuccessfulSyncAt: z.string().nullable(),
  cached: z.boolean().default(false),
});

export const meetingFiltersSchema = z.object({
  country: countrySchema.optional(),
  assignedUserId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const assignmentInputSchema = z.object({
  assignedUserId: z.string().nullable(),
});

export const syncResponseSchema = z.object({
  imported: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  syncedAt: z.string(),
});

export type Country = z.infer<typeof countrySchema>;
export type Meeting = z.infer<typeof meetingSchema>;
export type MeetingsResponse = z.infer<typeof meetingsResponseSchema>;
export type MeetingFilters = z.infer<typeof meetingFiltersSchema>;
export type AssignmentInput = z.infer<typeof assignmentInputSchema>;
export type SyncResponse = z.infer<typeof syncResponseSchema>;

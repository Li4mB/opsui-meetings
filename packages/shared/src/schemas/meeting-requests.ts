import { z } from "zod";

export const meetingRequestModuleOptions = [
  "Order Management",
  "Inventory Management",
  "Receiving/Inbound",
  "Shipping/Outbound",
  "Cycle Counting",
  "Wave Picking",
  "Zone Picking",
  "Slotting Optimization",
  "Route Optimization",
  "Quality Control",
  "Exceptions Management",
  "Business Rules Engine",
  "Dashboards & Reporting",
  "ML/AI Predictions",
  "Finance & Accounting",
  "Human Resources",
  "Production/Manufacturing",
  "Procurement",
  "Maintenance Management",
  "Returns Management (RMA)",
] as const;

export const meetingRequestMeetingModeSchema = z.enum([
  "google_meet",
  "in_person",
]);

export const meetingRequestModuleSchema = z.enum(meetingRequestModuleOptions);
export const meetingRequestCountrySchema = z.enum([
  "Australia",
  "New Zealand",
  "Unknown",
]);

export const createMeetingRequestInputSchema = z.object({
  clientName: z.string().min(2).max(80),
  email: z.string().email(),
  phone: z.string().min(6).max(40),
  companyName: z.string().min(2).max(120),
  country: meetingRequestCountrySchema,
  businessSize: z.string().min(1).max(80),
  modules: z.array(meetingRequestModuleSchema).min(1).max(20),
  meetingMode: meetingRequestMeetingModeSchema,
  preferredDate: z.string().min(1).max(40),
  preferredTime: z.string().min(1).max(40),
  additionalInfo: z.string().max(2000).default(""),
});

export const meetingRequestSchema = createMeetingRequestInputSchema.extend({
  id: z.string(),
  createdByUserId: z.string(),
  createdAt: z.string(),
});

export type MeetingRequestModule = z.infer<typeof meetingRequestModuleSchema>;
export type MeetingRequestMeetingMode = z.infer<
  typeof meetingRequestMeetingModeSchema
>;
export type MeetingRequestCountry = z.infer<typeof meetingRequestCountrySchema>;
export type CreateMeetingRequestInput = z.infer<
  typeof createMeetingRequestInputSchema
>;
export type MeetingRequest = z.infer<typeof meetingRequestSchema>;

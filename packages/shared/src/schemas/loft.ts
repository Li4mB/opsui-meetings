import { z } from "zod";

export const loftBookingSchema = z.object({
  id: z.string(),
  name: z.string(),
  business: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  message: z.string().default(""),
  submittedAt: z.string(),
  createdAt: z.string(),
});

export const loftBookingsResponseSchema = z.object({
  bookings: z.array(loftBookingSchema),
});

export const loftAccessResponseSchema = z.object({
  hasAccess: z.boolean(),
});

export const loftUnlockInputSchema = z.object({
  password: z.string().min(1),
});

export const createLoftBookingInputSchema = z.object({
  name: z.string().min(1),
  business: z.string().optional().default(""),
  email: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  message: z.string().optional().default(""),
  submittedAt: z.string().optional(),
});

export type LoftBooking = z.infer<typeof loftBookingSchema>;
export type LoftBookingsResponse = z.infer<typeof loftBookingsResponseSchema>;
export type LoftAccessResponse = z.infer<typeof loftAccessResponseSchema>;
export type CreateLoftBookingInput = z.infer<
  typeof createLoftBookingInputSchema
>;

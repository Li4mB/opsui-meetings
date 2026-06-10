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

// --- LoftAU payment packages ---------------------------------------------
// The two purchasable packages. Each maps to a reusable Stripe Payment Link
// (created in the Stripe dashboard) that encodes the one-time setup fee plus the
// recurring $50/month subscription with a 30-day free trial (first month's
// running on us). The display fields here are reused by the desktop UI and the
// payment-link email payload so they stay consistent.
export const loftPackageKeys = ["connect", "automate"] as const;
export const loftPackageSchema = z.enum(loftPackageKeys);
export type LoftPackageKey = z.infer<typeof loftPackageSchema>;

export type LoftPackageInfo = {
  key: LoftPackageKey;
  name: string;
  tagline: string;
  /** One-time setup price, display string. */
  setup: string;
  /** Recurring monthly price, display string. */
  monthly: string;
};

export const LOFT_PACKAGES: Record<LoftPackageKey, LoftPackageInfo> = {
  connect: {
    key: "connect",
    name: "Connect",
    tagline: "24/7 AI agent + one connector",
    setup: "$189",
    monthly: "$50",
  },
  automate: {
    key: "automate",
    name: "Automate",
    tagline: "Full webhook-backed workflow agent",
    setup: "$489",
    monthly: "$50",
  },
};

export const sendLoftPaymentLinkInputSchema = z.object({
  package: loftPackageSchema,
});

export const sendLoftPaymentLinkResponseSchema = z.object({
  ok: z.boolean(),
  bookingId: z.string(),
  package: loftPackageSchema,
  emailedTo: z.string(),
  paymentUrl: z.string().url(),
});

export type SendLoftPaymentLinkInput = z.infer<
  typeof sendLoftPaymentLinkInputSchema
>;
export type SendLoftPaymentLinkResponse = z.infer<
  typeof sendLoftPaymentLinkResponseSchema
>;

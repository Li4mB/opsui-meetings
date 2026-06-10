import {
  createLoftBookingInputSchema,
  loftAccessResponseSchema,
  loftBookingSchema,
  loftBookingsResponseSchema,
  loftUnlockInputSchema,
  sendLoftPaymentLinkInputSchema,
  sendLoftPaymentLinkResponseSchema,
  LOFT_PACKAGES,
} from "@opsui/shared";
import { nanoid } from "nanoid";
import { z } from "zod";
import { storage } from "../db/database.js";
import { env } from "../config/env.js";
import { authenticateRequest } from "./auth.js";
import type { DbLoftBookingRow } from "../types.js";

const toLoftBooking = (row: DbLoftBookingRow) =>
  loftBookingSchema.parse({
    id: row.id,
    name: row.name,
    business: row.business,
    email: row.email,
    phone: row.phone,
    message: row.message,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
  });

export const registerLoftRoutes = (app: import("fastify").FastifyInstance) => {
  app.post("/loft/bookings", async (request, reply) => {
    if (!env.loftIngestKey) {
      return reply.serviceUnavailable("Loft ingest is not configured");
    }

    if (request.headers["x-loft-key"] !== env.loftIngestKey) {
      return reply.unauthorized("Invalid loft ingest key");
    }

    const input = createLoftBookingInputSchema.parse(request.body);
    const now = new Date().toISOString();
    const id = nanoid();

    await storage.insertLoftBooking({
      id,
      name: input.name,
      business: input.business,
      email: input.email,
      phone: input.phone,
      message: input.message,
      submitted_at: input.submittedAt ?? now,
      created_at: now,
    } satisfies DbLoftBookingRow);

    return { ok: true, id };
  });

  app.get(
    "/loft/bookings",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const currentUser = request.user;

      if (!currentUser) {
        return reply.unauthorized("Missing authenticated user");
      }

      if (!(await storage.hasLoftAccess(currentUser.id))) {
        return reply.forbidden("Loft access required");
      }

      const rows = await storage.listLoftBookings();

      return loftBookingsResponseSchema.parse({
        bookings: rows.map(toLoftBooking),
      });
    },
  );

  app.get(
    "/loft/access",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const currentUser = request.user;

      if (!currentUser) {
        return reply.unauthorized("Missing authenticated user");
      }

      return loftAccessResponseSchema.parse({
        hasAccess: await storage.hasLoftAccess(currentUser.id),
      });
    },
  );

  app.post(
    "/loft/unlock",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const currentUser = request.user;

      if (!currentUser) {
        return reply.unauthorized("Missing authenticated user");
      }

      const input = loftUnlockInputSchema.parse(request.body);

      if (input.password !== env.loftAccessPassword) {
        return reply.unauthorized("Incorrect password");
      }

      await storage.grantLoftAccess(currentUser.id);

      return { hasAccess: true };
    },
  );

  // Send a Stripe payment-link email for a booking. We resolve the reusable
  // Stripe Payment Link for the chosen package and hand the booking + link to a
  // Make.com webhook, which composes and sends the email (mirrors how meeting
  // requests are dispatched). No Stripe secret key is needed in the app — the
  // links are created once in the Stripe dashboard.
  app.post(
    "/loft/bookings/:id/payment-link",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const currentUser = request.user;

      if (!currentUser) {
        return reply.unauthorized("Missing authenticated user");
      }

      if (!(await storage.hasLoftAccess(currentUser.id))) {
        return reply.forbidden("Loft access required");
      }

      const { id } = z
        .object({ id: z.string().min(1) })
        .parse(request.params);
      const { package: packageKey } = sendLoftPaymentLinkInputSchema.parse(
        request.body,
      );

      const rows = await storage.listLoftBookings();
      const row = rows.find((candidate) => candidate.id === id);

      if (!row) {
        return reply.notFound("Booking not found");
      }

      const booking = toLoftBooking(row);

      if (!booking.email) {
        return reply.badRequest(
          "This enquiry has no email address to send a payment link to.",
        );
      }

      const paymentUrl =
        packageKey === "connect"
          ? env.loftStripePaymentLinkConnect
          : env.loftStripePaymentLinkAutomate;

      if (!paymentUrl) {
        return reply.serviceUnavailable(
          `Stripe payment link for the ${packageKey} package is not configured.`,
        );
      }

      // Validate the configured URL BEFORE we send anything, so a misconfigured
      // env value (placeholder, missing scheme) can never email a broken link
      // and then surface as a post-send error that invites a duplicate send.
      if (!z.string().url().safeParse(paymentUrl).success) {
        return reply.serviceUnavailable(
          `Stripe payment link for the ${packageKey} package is misconfigured (not a valid URL).`,
        );
      }

      if (!env.loftPaymentWebhookUrl) {
        return reply.serviceUnavailable(
          "Payment email webhook is not configured.",
        );
      }

      const info = LOFT_PACKAGES[packageKey];

      let response: Response;

      try {
        response = await fetch(env.loftPaymentWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "loft_payment_link",
            idempotencyKey: `${booking.id}:${packageKey}`,
            bookingId: booking.id,
            name: booking.name,
            email: booking.email,
            business: booking.business,
            phone: booking.phone,
            package: packageKey,
            packageName: info.name,
            packageTagline: info.tagline,
            setup: info.setup,
            monthly: info.monthly,
            paymentUrl,
            sentByName: currentUser.displayName,
            sentByUserId: currentUser.id,
            sentAt: new Date().toISOString(),
          }),
        });
      } catch (error) {
        request.log.error({ err: error }, "Loft payment webhook unreachable");
        return reply.badGateway("Could not reach the payment email service.");
      }

      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        // Log the upstream body server-side for debugging, but don't echo it to
        // the client (avoid leaking internal integration details).
        request.log.error(
          { status: response.status, body: responseText },
          "Loft payment webhook failed",
        );
        return reply.badGateway(
          `Payment email service failed with status ${response.status}.`,
        );
      }

      return sendLoftPaymentLinkResponseSchema.parse({
        ok: true,
        bookingId: booking.id,
        package: packageKey,
        emailedTo: booking.email,
        paymentUrl,
      });
    },
  );
};

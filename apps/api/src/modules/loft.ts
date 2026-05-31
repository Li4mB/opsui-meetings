import {
  createLoftBookingInputSchema,
  loftAccessResponseSchema,
  loftBookingSchema,
  loftBookingsResponseSchema,
  loftUnlockInputSchema,
} from "@opsui/shared";
import { nanoid } from "nanoid";
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
};

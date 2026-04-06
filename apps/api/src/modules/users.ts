import argon2 from "argon2";
import {
  createUserInputSchema,
  updateUserInputSchema,
  userSchema,
} from "@opsui/shared";
import { nanoid } from "nanoid";
import { storage } from "../db/database.js";
import { authenticateRequest, requireAdmin } from "./auth.js";
import type { DbUserRow } from "../types.js";

const toUser = (row: DbUserRow) =>
  userSchema.parse({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    colorHex: row.color_hex,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

export const registerUserRoutes = (app: import("fastify").FastifyInstance) => {
  const updateUserHandler = async (
    request: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply,
  ) => {
    const id = (request.params as { id: string }).id;
    const input = updateUserInputSchema.parse(request.body);
    const existing = await storage.findUserById(id);

    if (!existing) {
      return reply.notFound("User not found");
    }

    const updated = {
      ...existing,
      username: input.username ?? existing.username,
      display_name: input.displayName ?? existing.display_name,
      role: input.role ?? existing.role,
      color_hex: input.colorHex ?? existing.color_hex,
      active: input.active === undefined ? existing.active : Number(input.active),
      password_hash: input.password
        ? await argon2.hash(input.password)
        : existing.password_hash,
      updated_at: new Date().toISOString(),
    };

    await storage.updateUser(updated);

    return toUser(updated);
  };

  const deleteUserHandler = async (
    request: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply,
  ) => {
    const id = (request.params as { id: string }).id;

    await storage.clearMeetingAssignmentsForUser(id);
    const deleted = await storage.deleteUserById(id);

    if (!deleted) {
      return reply.notFound("User not found");
    }

    return reply.status(204).send();
  };

  app.get(
    "/users",
    { preHandler: [authenticateRequest] },
    async () => {
      const rows = await storage.listUsers();

      return rows.map(toUser);
    },
  );

  app.post(
    "/users",
    { preHandler: [authenticateRequest, requireAdmin] },
    async (request, reply) => {
      const input = createUserInputSchema.parse(request.body);
      const now = new Date().toISOString();

      const existing = await storage.findUserIdByUsername(input.username);

      if (existing) {
        return reply.conflict("Username already exists");
      }

      const user = {
        id: nanoid(),
        username: input.username,
        display_name: input.displayName,
        role: input.role,
        password_hash: await argon2.hash(input.password),
        color_hex: input.colorHex,
        active: 1,
        created_at: now,
        updated_at: now,
      };

      await storage.insertUser(user);

      return toUser(user);
    },
  );

  app.patch(
    "/users/:id",
    { preHandler: [authenticateRequest, requireAdmin] },
    updateUserHandler,
  );

  app.post(
    "/users/:id/update",
    { preHandler: [authenticateRequest, requireAdmin] },
    updateUserHandler,
  );

  app.delete(
    "/users/:id",
    { preHandler: [authenticateRequest, requireAdmin] },
    deleteUserHandler,
  );

  app.post(
    "/users/:id/delete",
    { preHandler: [authenticateRequest, requireAdmin] },
    deleteUserHandler,
  );
};

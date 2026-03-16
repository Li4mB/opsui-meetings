import argon2 from "argon2";
import {
  createUserInputSchema,
  updateUserInputSchema,
  userSchema,
} from "@opsui/shared";
import { nanoid } from "nanoid";
import { db } from "../db/database.js";
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
    const existing = db
      .prepare<unknown[], DbUserRow>("SELECT * FROM users WHERE id = ? LIMIT 1")
      .get(id);

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

    db.prepare(`
      UPDATE users
      SET username = ?, display_name = ?, role = ?, password_hash = ?, color_hex = ?, active = ?, updated_at = ?
      WHERE id = ?
    `).run(
      updated.username,
      updated.display_name,
      updated.role,
      updated.password_hash,
      updated.color_hex,
      updated.active,
      updated.updated_at,
      id,
    );

    return toUser(updated);
  };

  const deleteUserHandler = async (
    request: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply,
  ) => {
    const id = (request.params as { id: string }).id;

    db.prepare("UPDATE meetings SET assigned_user_id = NULL WHERE assigned_user_id = ?").run(id);
    const result = db.prepare("DELETE FROM users WHERE id = ?").run(id);

    if (!result.changes) {
      return reply.notFound("User not found");
    }

    return reply.status(204).send();
  };

  app.get(
    "/users",
    { preHandler: [authenticateRequest] },
    async () => {
      const rows = db
        .prepare<unknown[], DbUserRow>("SELECT * FROM users ORDER BY display_name ASC")
        .all();

      return rows.map(toUser);
    },
  );

  app.post(
    "/users",
    { preHandler: [authenticateRequest, requireAdmin] },
    async (request, reply) => {
      const input = createUserInputSchema.parse(request.body);
      const now = new Date().toISOString();

      const existing = db
        .prepare("SELECT id FROM users WHERE username = ? LIMIT 1")
        .get(input.username);

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

      db.prepare(`
        INSERT INTO users (
          id, username, display_name, role, password_hash, color_hex, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        user.id,
        user.username,
        user.display_name,
        user.role,
        user.password_hash,
        user.color_hex,
        user.active,
        user.created_at,
        user.updated_at,
      );

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

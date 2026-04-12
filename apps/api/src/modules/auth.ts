import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";
import {
  authBootstrapSchema,
  loginInputSchema,
  sessionSchema,
} from "@opsui/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { storage } from "../db/database.js";
import { env } from "../config/env.js";
import type { AuthUser, DbUserRow } from "../types.js";

const secret = new TextEncoder().encode(env.jwtSecret);

const toAuthUser = (user: DbUserRow): AuthUser => ({
  id: user.id,
  username: user.username,
  displayName: user.display_name,
  role: user.role,
  colorHex: user.color_hex,
});

const resolveAuthenticatedUser = async (payload: Record<string, unknown>) => {
  const subjectId = typeof payload.sub === "string" ? payload.sub : "";
  const username = typeof payload.username === "string" ? payload.username : "";

  const userById = subjectId ? await storage.findUserById(subjectId) : null;

  if (userById?.active) {
    return userById;
  }

  if (!username) {
    return null;
  }

  return storage.findActiveUserByUsername(username);
};

export const signSession = async (user: AuthUser) =>
  new SignJWT({
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    colorHex: user.colorHex,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);

export const authenticateRequest = async (request: FastifyRequest, reply: FastifyReply) => {
  const header = request.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return reply.unauthorized("Missing bearer token");
  }

  try {
    const token = header.replace("Bearer ", "");
    const { payload } = await jwtVerify(token, secret);
    const user = await resolveAuthenticatedUser(payload);

    if (!user) {
      return reply.unauthorized("Invalid or expired session");
    }

    request.user = toAuthUser(user);
  } catch {
    return reply.unauthorized("Invalid or expired session");
  }
};

export const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
  if (request.user?.role !== "admin") {
    return reply.forbidden("Admin access required");
  }
};

export const registerAuthRoutes = (app: import("fastify").FastifyInstance) => {
  app.get("/auth/bootstrap", async () => {
    const users = (await storage.listUsers())
      .filter((user) => Boolean(user.active))
      .map((user) => ({
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        colorHex: user.color_hex,
      }));

    return authBootstrapSchema.parse({ users });
  });

  app.post("/auth/login", async (request, reply) => {
    const input = loginInputSchema.parse(request.body);
    const user = await storage.findActiveUserByUsername(input.username);

    if (!user) {
      return reply.unauthorized("Invalid username or password");
    }

    const valid = await argon2.verify(user.password_hash, input.password);

    if (!valid) {
      return reply.unauthorized("Invalid username or password");
    }

    const session = {
      user: toAuthUser(user),
      token: await signSession(toAuthUser(user)),
    };

    return sessionSchema.parse(session);
  });

  app.get(
    "/auth/me",
    { preHandler: [authenticateRequest] },
    async (request) => {
      return { user: request.user };
    },
  );

  app.post(
    "/auth/logout",
    { preHandler: [authenticateRequest] },
    async (_request, reply) => reply.status(204).send(),
  );
};

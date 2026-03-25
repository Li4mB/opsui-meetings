import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { ZodError } from "zod";
import type { AuthUser } from "./types.js";
import { env } from "./config/env.js";
import { registerAuthRoutes } from "./modules/auth.js";
import { registerAiRoutes } from "./modules/ai.js";
import { registerMeetingRoutes } from "./modules/meetings.js";
import { registerMeetingRequestRoutes } from "./modules/meeting-requests.js";
import { registerUserRoutes } from "./modules/users.js";
import { seedAdminIfMissing } from "./db/database.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

const buildServer = async () => {
  await seedAdminIfMissing();

  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(sensible);

  app.get("/health", async () => ({
    status: "ok",
    mode: env.useSampleData || !env.googleCalendarId ? "sample" : "google",
    timestamp: new Date().toISOString(),
  }));

  app.get("/release-config", async () => ({
    minimumVersion: "0.1.0",
    mandatory: false,
  }));

  registerAuthRoutes(app);
  registerAiRoutes(app);
  registerMeetingRequestRoutes(app);
  registerUserRoutes(app);
  registerMeetingRoutes(app);

  app.setErrorHandler((error: unknown, _request, reply) => {
    const appError =
      error instanceof Error ? error : new Error("Unexpected server error");
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    const hasValidation =
      typeof error === "object" && error !== null && "validation" in error;

    if (hasValidation) {
      return reply.badRequest(appError.message);
    }

    if (error instanceof ZodError) {
      const message = error.issues
        .map((issue) => {
          const field = issue.path.length ? issue.path.join(".") : "field";
          return `${field}: ${issue.message}`;
        })
        .join(" | ");

      return reply.badRequest(message || "Invalid request payload");
    }

    if (statusCode >= 500) {
      app.log.error(appError);
    }

    return reply.status(statusCode).send({ message: appError.message });
  });

  return app;
};

const app = await buildServer();

await app.listen({
  port: env.port,
  host: "0.0.0.0",
});

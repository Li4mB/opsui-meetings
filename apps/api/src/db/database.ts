import { env } from "../config/env.js";
import { createPostgresAdapter } from "./postgres-adapter.js";
import { createSqliteAdapter } from "./sqlite-adapter.js";

export const storage =
  env.dbProvider === "postgres"
    ? createPostgresAdapter()
    : createSqliteAdapter();

export const initializeDatabase = async () => {
  await storage.initialize();
};

export const seedAdminIfMissing = async () => {
  await storage.seedAdminIfMissing();
};

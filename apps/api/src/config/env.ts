import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..", "..");

config({
  path: path.resolve(appRoot, ".env"),
});

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) {
    return fallback;
  }

  return value.toLowerCase() === "true";
};

const normalizeDbProvider = (value: string | undefined) => {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (normalized === "supabase") {
    return "postgres";
  }

  if (normalized === "sqlite" || normalized === "postgres") {
    return normalized;
  }

  throw new Error(
    `Unsupported OPSUI_DB_PROVIDER "${value}". Expected "sqlite", "postgres", or "supabase".`,
  );
};

const normalizeDbSchema = (value: string | undefined) => {
  const normalized = value?.trim() || "opsui";

  if (!/^[a-z_][a-z0-9_]*$/i.test(normalized)) {
    throw new Error(
      `Unsupported OPSUI_DB_SCHEMA "${normalized}". Use letters, numbers, and underscores only.`,
    );
  }

  return normalized;
};

const dbUrl =
  process.env.OPSUI_DB_URL?.trim() ||
  process.env.SUPABASE_DB_URL?.trim() ||
  process.env.POSTGRES_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  "";

const dbProvider =
  normalizeDbProvider(process.env.OPSUI_DB_PROVIDER) ??
  (dbUrl ? "postgres" : "sqlite");

export const env = {
  appRoot,
  port: Number(process.env.PORT ?? 8787),
  jwtSecret: process.env.JWT_SECRET ?? "opsui-dev-secret",
  apiOrigin: process.env.OPSUI_API_ORIGIN ?? "http://localhost:1420",
  useSampleData: parseBoolean(process.env.OPSUI_USE_SAMPLE_DATA, true),
  seedAdminUsername: process.env.OPSUI_SEED_ADMIN_USERNAME ?? "opsui-admin",
  seedAdminPassword: process.env.OPSUI_SEED_ADMIN_PASSWORD ?? "ChangeMe123!",
  seedAdminDisplayName: process.env.OPSUI_SEED_ADMIN_DISPLAY_NAME ?? "OpsUI Admin",
  googleCalendarId: process.env.OPSUI_GOOGLE_CALENDAR_ID ?? "",
  googleServiceAccountJson: process.env.OPSUI_GOOGLE_SERVICE_ACCOUNT_JSON ?? "",
  googleDriveBriefsFolderId:
    process.env.OPSUI_GOOGLE_DRIVE_BRIEFS_FOLDER_ID ?? "",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiModel: process.env.OPSUI_OPENAI_MODEL ?? "gpt-5.2",
  openAiVectorStoreId: process.env.OPSUI_OPENAI_VECTOR_STORE_ID ?? "",
  makeMeetingRequestWebhookUrl:
    process.env.OPSUI_MAKE_MEETING_REQUEST_WEBHOOK_URL ?? "",
  dbProvider,
  dbUrl,
  dbSsl: parseBoolean(process.env.OPSUI_DB_SSL, dbProvider === "postgres"),
  dbSchema: normalizeDbSchema(process.env.OPSUI_DB_SCHEMA),
  dbPath:
    process.env.OPSUI_DB_PATH?.trim() ||
    path.resolve(appRoot, "data", "opsui-meetings.sqlite"),
};

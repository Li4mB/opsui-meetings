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

const isRender = process.env.RENDER === "true";
const renderExternalUrl =
  process.env.RENDER_EXTERNAL_URL?.trim() ||
  (process.env.RENDER_EXTERNAL_HOSTNAME?.trim()
    ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME.trim()}`
    : "");

const defaultSqliteDbPath = isRender
  ? "/var/data/opsui-meetings.sqlite"
  : path.resolve(appRoot, "data", "opsui-meetings.sqlite");

const dbPath = process.env.OPSUI_DB_PATH?.trim() || defaultSqliteDbPath;

if (
  isRender &&
  dbProvider === "sqlite" &&
  path.resolve(dbPath).startsWith(path.resolve(appRoot))
) {
  throw new Error(
    `Render SQLite database path "${dbPath}" is inside the deploy directory and will be wiped on deploy. ` +
      "Set OPSUI_DB_PATH=/var/data/opsui-meetings.sqlite on a Render persistent disk, or set OPSUI_DB_PROVIDER=postgres with OPSUI_DB_URL.",
  );
}

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
  openAiCaptionModel: process.env.OPSUI_OPENAI_CAPTION_MODEL ?? "gpt-4o",
  openAiImageReasoningModel:
    process.env.OPSUI_OPENAI_IMAGE_REASONING_MODEL ?? "gpt-5.4",
  openAiImageModel: process.env.OPSUI_OPENAI_IMAGE_MODEL ?? "gpt-image-1.5",
  openAiVectorStoreId: process.env.OPSUI_OPENAI_VECTOR_STORE_ID ?? "",
  makeMeetingRequestWebhookUrl:
    process.env.OPSUI_MAKE_MEETING_REQUEST_WEBHOOK_URL ?? "",
  socialPublishWebhookUrl: process.env.OPSUI_SOCIAL_PUBLISH_WEBHOOK_URL ?? "",
  socialPublicApiUrl:
    process.env.OPSUI_PUBLIC_API_URL?.trim() || renderExternalUrl,
  metaGraphApiVersion: process.env.OPSUI_META_GRAPH_API_VERSION ?? "v24.0",
  linkedinApiVersion: process.env.OPSUI_LINKEDIN_API_VERSION ?? "202601",
  facebookPageId: process.env.OPSUI_FACEBOOK_PAGE_ID ?? "",
  facebookPageAccessToken:
    process.env.OPSUI_FACEBOOK_PAGE_ACCESS_TOKEN ?? "",
  instagramUserId: process.env.OPSUI_INSTAGRAM_USER_ID ?? "",
  instagramAccessToken: process.env.OPSUI_INSTAGRAM_ACCESS_TOKEN ?? "",
  linkedinAuthorUrn:
    process.env.OPSUI_LINKEDIN_AUTHOR_URN ||
    (process.env.OPSUI_LINKEDIN_ORGANIZATION_ID
      ? `urn:li:organization:${process.env.OPSUI_LINKEDIN_ORGANIZATION_ID}`
      : ""),
  linkedinAccessToken: process.env.OPSUI_LINKEDIN_ACCESS_TOKEN ?? "",
  xAccountId: process.env.OPSUI_X_ACCOUNT_ID ?? "",
  xAccessToken: process.env.OPSUI_X_ACCESS_TOKEN ?? "",
  xClientId: process.env.OPSUI_X_CLIENT_ID ?? "",
  xClientSecret: process.env.OPSUI_X_CLIENT_SECRET ?? "",
  loftIngestKey: process.env.OPSUI_LOFT_INGEST_KEY ?? "",
  loftAccessPassword: process.env.OPSUI_LOFT_ACCESS_PASSWORD ?? "0770",
  dbProvider,
  dbUrl,
  dbSsl: parseBoolean(process.env.OPSUI_DB_SSL, dbProvider === "postgres"),
  dbSchema: normalizeDbSchema(process.env.OPSUI_DB_SCHEMA),
  dbPath,
};

import argon2 from "argon2";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import type {
  DbAiMeetingGuideRow,
  DbAiPostCaptionGenerationRow,
  DbAiPostImageGenerationRow,
  DbAutoPostAgentConfigRow,
  DbCallingBatchRow,
  DbCallingCallRow,
  DbCallingProspectRow,
  DbLoftBookingRow,
  DbMeetingRequestRow,
  DbMeetingRow,
  DbSocialPlatform,
  DbUserRow,
} from "../types.js";
import type {
  DbMeetingFilters,
  DbMeetingWithAssignmentRow,
  DbPastMeetingWithAssignmentRow,
  DbScheduledSocialPostWithCreatorRow,
  DbSocialAccountWithCreatorRow,
  ReplaceMeetingsResult,
  UpsertCallingProspectsResult,
  StorageAdapter,
} from "./adapter.js";

const schemaName = env.dbSchema;
const usersTable = `${schemaName}.users`;
const meetingsTable = `${schemaName}.meetings`;
const pastMeetingsTable = `${schemaName}.past_meetings`;
const syncStateTable = `${schemaName}.sync_state`;
const aiMeetingGuidesTable = `${schemaName}.ai_meeting_guides`;
const aiPostImageGenerationsTable = `${schemaName}.ai_post_image_generations`;
const aiPostCaptionGenerationsTable = `${schemaName}.ai_post_caption_generations`;
const autoPostAgentConfigTable = `${schemaName}.auto_post_agent_config`;
const meetingRequestsTable = `${schemaName}.meeting_requests`;
const scheduledSocialPostsTable = `${schemaName}.scheduled_social_posts`;
const socialAccountsTable = `${schemaName}.social_accounts`;
const loftBookingsTable = `${schemaName}.loft_bookings`;
const loftAccessTable = `${schemaName}.loft_access`;
const callingProspectsTable = `${schemaName}.calling_prospects`;
const callingBatchesTable = `${schemaName}.calling_batches`;
const callingCallsTable = `${schemaName}.calling_calls`;

const schemaSql = `
  CREATE SCHEMA IF NOT EXISTS ${schemaName};

  CREATE TABLE IF NOT EXISTS ${usersTable} (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
    password_hash TEXT NOT NULL,
    color_hex TEXT NOT NULL,
    active SMALLINT NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ${meetingsTable} (
    id TEXT PRIMARY KEY,
    google_event_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    client_name TEXT NOT NULL,
    company TEXT NOT NULL,
    country TEXT NOT NULL,
    meeting_type TEXT NOT NULL,
    start_at_utc TEXT NOT NULL,
    end_at_utc TEXT NOT NULL,
    source_timezone TEXT NOT NULL,
    google_meet_url TEXT,
    google_doc_url TEXT,
    client_email TEXT,
    phone TEXT,
    company_size TEXT,
    modules_of_interest_json TEXT NOT NULL,
    description_raw TEXT NOT NULL,
    calendar_html_url TEXT,
    assigned_user_id TEXT,
    updated_at TEXT NOT NULL,
    last_synced_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ${pastMeetingsTable} (
    id TEXT PRIMARY KEY,
    google_event_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    client_name TEXT NOT NULL,
    company TEXT NOT NULL,
    country TEXT NOT NULL,
    meeting_type TEXT NOT NULL,
    start_at_utc TEXT NOT NULL,
    end_at_utc TEXT NOT NULL,
    source_timezone TEXT NOT NULL,
    google_meet_url TEXT,
    google_doc_url TEXT,
    client_email TEXT,
    phone TEXT,
    company_size TEXT,
    modules_of_interest_json TEXT NOT NULL,
    description_raw TEXT NOT NULL,
    calendar_html_url TEXT,
    assigned_user_id TEXT,
    updated_at TEXT NOT NULL,
    last_synced_at TEXT NOT NULL,
    resolved_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ${syncStateTable} (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ${aiMeetingGuidesTable} (
    google_event_id TEXT PRIMARY KEY,
    guide_json TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ${aiPostImageGenerationsTable} (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    caption TEXT,
    tags_json TEXT NOT NULL,
    image_name TEXT NOT NULL,
    image_model TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_ai_post_image_generations_context
    ON ${aiPostImageGenerationsTable}(conversation_id, created_by_user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS ${aiPostCaptionGenerationsTable} (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    platform TEXT NOT NULL,
    caption TEXT NOT NULL,
    hashtags_json TEXT NOT NULL,
    model TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_ai_post_caption_generations_context
    ON ${aiPostCaptionGenerationsTable}(created_by_user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS ${autoPostAgentConfigTable} (
    id TEXT PRIMARY KEY,
    enabled SMALLINT NOT NULL DEFAULT 0,
    cadence_json TEXT NOT NULL DEFAULT '{}',
    posts_per_run INTEGER NOT NULL DEFAULT 1,
    target_account_ids_json TEXT NOT NULL DEFAULT '[]',
    image_style TEXT NOT NULL DEFAULT 'realistic',
    timezone TEXT NOT NULL DEFAULT 'Local timezone',
    last_run_at TEXT,
    slot_runs_json TEXT NOT NULL DEFAULT '{}',
    updated_by_user_id TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ${meetingRequestsTable} (
    id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    company_name TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'Unknown',
    business_size TEXT NOT NULL,
    modules_json TEXT NOT NULL,
    meeting_mode TEXT NOT NULL CHECK(meeting_mode IN ('google_meet', 'in_person')),
    preferred_date TEXT NOT NULL,
    preferred_time TEXT NOT NULL,
    additional_info TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ${scheduledSocialPostsTable} (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL CHECK(platform IN ('facebook', 'linkedin', 'twitter', 'instagram')),
    account_id TEXT,
    caption TEXT NOT NULL,
    image_data_url TEXT,
    image_name TEXT,
    thumbnail_data_url TEXT,
    scheduled_for TEXT NOT NULL,
    timezone TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('scheduled', 'publishing', 'published', 'failed', 'connection_required', 'cancelled', 'pending_review')),
    status_message TEXT,
    external_post_id TEXT,
    published_at TEXT,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_scheduled_social_posts_due
    ON ${scheduledSocialPostsTable}(status, scheduled_for);

  CREATE TABLE IF NOT EXISTS ${socialAccountsTable} (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL CHECK(platform IN ('facebook', 'linkedin', 'twitter', 'instagram')),
    display_name TEXT NOT NULL,
    account_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    token_type TEXT,
    expires_at TEXT,
    scopes TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    active SMALLINT NOT NULL DEFAULT 1,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_social_accounts_platform
    ON ${socialAccountsTable}(platform, active);

  CREATE TABLE IF NOT EXISTS ${loftBookingsTable} (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    business TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    submitted_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ${loftAccessTable} (
    user_id TEXT PRIMARY KEY,
    granted_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ${callingProspectsTable} (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    company_name TEXT NOT NULL,
    email TEXT,
    notes TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL CHECK(source IN ('manual', 'google_sheet')) DEFAULT 'manual',
    external_id TEXT UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('new', 'queued', 'calling', 'completed', 'failed', 'do_not_call')) DEFAULT 'new',
    last_call_at TEXT,
    last_call_outcome TEXT,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_calling_prospects_status
    ON ${callingProspectsTable}(status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS ${callingBatchesTable} (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')) DEFAULT 'queued',
    total_count INTEGER NOT NULL,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_calling_batches_status
    ON ${callingBatchesTable}(status, created_at DESC);

  CREATE TABLE IF NOT EXISTS ${callingCallsTable} (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES ${callingBatchesTable}(id) ON DELETE CASCADE,
    prospect_id TEXT NOT NULL REFERENCES ${callingProspectsTable}(id),
    sequence_index INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued', 'calling', 'completed', 'failed', 'skipped', 'cancelled')) DEFAULT 'queued',
    outcome TEXT,
    notes TEXT NOT NULL DEFAULT '',
    duration_seconds INTEGER,
    external_call_id TEXT,
    status_message TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_calling_calls_batch
    ON ${callingCallsTable}(batch_id, sequence_index);

  CREATE INDEX IF NOT EXISTS idx_calling_calls_status
    ON ${callingCallsTable}(status, updated_at DESC);

  -- Migrations for existing databases (idempotent).
  -- Allow multiple accounts per platform: drop the legacy UNIQUE(platform).
  ALTER TABLE ${socialAccountsTable}
    DROP CONSTRAINT IF EXISTS social_accounts_platform_key;
  -- Reference the specific account a scheduled post targets.
  ALTER TABLE ${scheduledSocialPostsTable}
    ADD COLUMN IF NOT EXISTS account_id TEXT;
  -- Per-slot last-fired state for the auto-post agent.
  ALTER TABLE ${autoPostAgentConfigTable}
    ADD COLUMN IF NOT EXISTS slot_runs_json TEXT NOT NULL DEFAULT '{}';
  -- Widen the status CHECK to allow the agent's 'pending_review' drafts.
  DO $$
  BEGIN
    ALTER TABLE ${scheduledSocialPostsTable}
      DROP CONSTRAINT IF EXISTS scheduled_social_posts_status_check;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'scheduled_social_posts_status_check_v2'
        AND conrelid = '${scheduledSocialPostsTable}'::regclass
    ) THEN
      ALTER TABLE ${scheduledSocialPostsTable}
        ADD CONSTRAINT scheduled_social_posts_status_check_v2
        CHECK (status IN ('scheduled', 'publishing', 'published', 'failed', 'connection_required', 'cancelled', 'pending_review'));
    END IF;
  END $$;
`;

const selectActiveMeetingsQuery = `
  SELECT
    meetings.*,
    users.display_name AS assigned_user_name,
    users.color_hex AS assigned_user_color
  FROM ${meetingsTable} AS meetings
  LEFT JOIN ${usersTable} AS users ON users.id = meetings.assigned_user_id
`;

const selectPastMeetingsQuery = `
  SELECT
    past_meetings.*,
    users.display_name AS assigned_user_name,
    users.color_hex AS assigned_user_color
  FROM ${pastMeetingsTable} AS past_meetings
  LEFT JOIN ${usersTable} AS users ON users.id = past_meetings.assigned_user_id
`;

const selectScheduledSocialPostsQuery = `
  SELECT
    scheduled_social_posts.*,
    users.display_name AS created_by_user_name
  FROM ${scheduledSocialPostsTable} AS scheduled_social_posts
  LEFT JOIN ${usersTable} AS users ON users.id = scheduled_social_posts.created_by_user_id
`;

const selectSocialAccountsQuery = `
  SELECT
    social_accounts.*,
    users.display_name AS created_by_user_name
  FROM ${socialAccountsTable} AS social_accounts
  LEFT JOIN ${usersTable} AS users ON users.id = social_accounts.created_by_user_id
`;

const buildWhereClause = (
  tableName: "meetings" | "past_meetings",
  filters: DbMeetingFilters,
) => {
  const clauses: string[] = [];
  const values: string[] = [];

  if (filters.country) {
    values.push(filters.country);
    clauses.push(`${tableName}.country = $${values.length}`);
  }

  if (filters.assignedUserId) {
    values.push(filters.assignedUserId);
    clauses.push(`${tableName}.assigned_user_id = $${values.length}`);
  }

  if (filters.from) {
    values.push(filters.from);
    clauses.push(`${tableName}.start_at_utc >= $${values.length}`);
  }

  if (filters.to) {
    values.push(filters.to);
    clauses.push(`${tableName}.start_at_utc <= $${values.length}`);
  }

  return {
    values,
    whereClause: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
  };
};

export const createPostgresAdapter = (): StorageAdapter => {
  let pool: Pool | null = null;

  const getPool = () => {
    if (!pool) {
      throw new Error("Postgres storage has not been initialized.");
    }

    return pool;
  };

  const queryRows = async <TRow extends QueryResultRow>(
    text: string,
    values: unknown[] = [],
    client?: PoolClient,
  ) => {
    const executor = client ?? getPool();
    const result = await executor.query<TRow>(text, values);
    return result.rows;
  };

  const queryRow = async <TRow extends QueryResultRow>(
    text: string,
    values: unknown[] = [],
    client?: PoolClient,
  ) => {
    const rows = await queryRows<TRow>(text, values, client);
    return rows[0] ?? null;
  };

  const execute = async (text: string, values: unknown[] = [], client?: PoolClient) => {
    const executor = client ?? getPool();
    return executor.query(text, values);
  };

  const withTransaction = async <T>(callback: (client: PoolClient) => Promise<T>) => {
    const client = await getPool().connect();

    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  return {
    async initialize() {
      if (pool) {
        return;
      }

      if (!env.dbUrl) {
        throw new Error(
          "Set OPSUI_DB_URL, SUPABASE_DB_URL, POSTGRES_URL, or DATABASE_URL when OPSUI_DB_PROVIDER is postgres.",
        );
      }

      pool = new Pool({
        connectionString: env.dbUrl,
        ssl: env.dbSsl ? { rejectUnauthorized: false } : undefined,
      });

      await pool.query(schemaSql);
    },

    async close() {
      if (pool) {
        await pool.end();
        pool = null;
      }
    },

    async seedAdminIfMissing() {
      const existing = await queryRow<{ id: string }>(
        `SELECT id FROM ${usersTable} WHERE username = $1 LIMIT 1`,
        [env.seedAdminUsername],
      );

      if (existing) {
        return;
      }

      const timestamp = new Date().toISOString();
      const passwordHash = await argon2.hash(env.seedAdminPassword);

      await execute(
        `
          INSERT INTO ${usersTable} (
            id,
            username,
            display_name,
            role,
            password_hash,
            color_hex,
            active,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8)
        `,
        [
          nanoid(),
          env.seedAdminUsername,
          env.seedAdminDisplayName,
          "admin",
          passwordHash,
          "#4FD1C5",
          timestamp,
          timestamp,
        ],
      );
    },

    async findActiveUserByUsername(username) {
      return queryRow<DbUserRow>(
        `SELECT * FROM ${usersTable} WHERE username = $1 AND active = 1 LIMIT 1`,
        [username],
      );
    },

    async findUserById(id) {
      return queryRow<DbUserRow>(`SELECT * FROM ${usersTable} WHERE id = $1 LIMIT 1`, [id]);
    },

    async findUserIdByUsername(username) {
      return queryRow<{ id: string }>(
        `SELECT id FROM ${usersTable} WHERE username = $1 LIMIT 1`,
        [username],
      );
    },

    async listUsers() {
      return queryRows<DbUserRow>(`SELECT * FROM ${usersTable} ORDER BY display_name ASC`);
    },

    async insertUser(user) {
      await execute(
        `
          INSERT INTO ${usersTable} (
            id,
            username,
            display_name,
            role,
            password_hash,
            color_hex,
            active,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          user.id,
          user.username,
          user.display_name,
          user.role,
          user.password_hash,
          user.color_hex,
          user.active,
          user.created_at,
          user.updated_at,
        ],
      );
    },

    async updateUser(user) {
      await execute(
        `
          UPDATE ${usersTable}
          SET username = $1, display_name = $2, role = $3, password_hash = $4, color_hex = $5, active = $6, updated_at = $7
          WHERE id = $8
        `,
        [
          user.username,
          user.display_name,
          user.role,
          user.password_hash,
          user.color_hex,
          user.active,
          user.updated_at,
          user.id,
        ],
      );
    },

    async clearMeetingAssignmentsForUser(userId) {
      await execute(
        `UPDATE ${meetingsTable} SET assigned_user_id = NULL WHERE assigned_user_id = $1`,
        [userId],
      );
    },

    async deleteUserById(userId) {
      const result = await execute(`DELETE FROM ${usersTable} WHERE id = $1`, [userId]);
      return (result.rowCount ?? 0) > 0;
    },

    async listMeetings(filters) {
      const { whereClause, values } = buildWhereClause("meetings", filters);
      return queryRows<DbMeetingWithAssignmentRow>(
        `${selectActiveMeetingsQuery}${whereClause} ORDER BY meetings.start_at_utc ASC`,
        values,
      );
    },

    async listPastMeetings(filters) {
      const { whereClause, values } = buildWhereClause("past_meetings", filters);
      return queryRows<DbPastMeetingWithAssignmentRow>(
        `${selectPastMeetingsQuery}${whereClause} ORDER BY past_meetings.start_at_utc DESC`,
        values,
      );
    },

    async getLastSuccessfulSyncAt() {
      const row = await queryRow<{ value: string }>(
        `SELECT value FROM ${syncStateTable} WHERE key = 'lastSuccessfulSyncAt' LIMIT 1`,
      );
      return row?.value ?? null;
    },

    async updateMeetingAssignment(meetingId, assignedUserId) {
      const result = await execute(
        `UPDATE ${meetingsTable} SET assigned_user_id = $1 WHERE id = $2`,
        [assignedUserId, meetingId],
      );

      if (!(result.rowCount ?? 0)) {
        return null;
      }

      return queryRow<DbMeetingWithAssignmentRow>(
        `${selectActiveMeetingsQuery} WHERE meetings.id = $1 LIMIT 1`,
        [meetingId],
      );
    },

    async resolveMeeting(meetingId, resolvedAt) {
      return withTransaction(async (client) => {
        const row = await queryRow<DbMeetingRow>(
          `SELECT * FROM ${meetingsTable} WHERE id = $1 LIMIT 1`,
          [meetingId],
          client,
        );

        if (!row) {
          return false;
        }

        await execute(
          `DELETE FROM ${pastMeetingsTable} WHERE google_event_id = $1`,
          [row.google_event_id],
          client,
        );
        await execute(
          `
            INSERT INTO ${pastMeetingsTable} (
              id,
              google_event_id,
              title,
              client_name,
              company,
              country,
              meeting_type,
              start_at_utc,
              end_at_utc,
              source_timezone,
              google_meet_url,
              google_doc_url,
              client_email,
              phone,
              company_size,
              modules_of_interest_json,
              description_raw,
              calendar_html_url,
              assigned_user_id,
              updated_at,
              last_synced_at,
              resolved_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
              $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
            )
          `,
          [
            row.id,
            row.google_event_id,
            row.title,
            row.client_name,
            row.company,
            row.country,
            row.meeting_type,
            row.start_at_utc,
            row.end_at_utc,
            row.source_timezone,
            row.google_meet_url,
            row.google_doc_url,
            row.client_email,
            row.phone,
            row.company_size,
            row.modules_of_interest_json,
            row.description_raw,
            row.calendar_html_url,
            row.assigned_user_id,
            row.updated_at,
            row.last_synced_at,
            resolvedAt,
          ],
          client,
        );
        await execute(`DELETE FROM ${meetingsTable} WHERE id = $1`, [meetingId], client);
        return true;
      });
    },

    async replaceMeetings(meetings) {
      return withTransaction(async (client) => {
        const resolvedRows = await queryRows<{ google_event_id: string }>(
          `SELECT google_event_id FROM ${pastMeetingsTable}`,
          [],
          client,
        );
        const resolvedGoogleEventIds = new Set(
          resolvedRows.map((row) => row.google_event_id),
        );
        const activeMeetings = meetings.filter(
          (meeting) => !resolvedGoogleEventIds.has(meeting.googleEventId),
        );
        const assignmentRows = await queryRows<{
          google_event_id: string;
          assigned_user_id: string | null;
        }>(`SELECT google_event_id, assigned_user_id FROM ${meetingsTable}`, [], client);
        const previousAssignments = assignmentRows.reduce<Record<string, string | null>>(
          (accumulator, row) => {
            accumulator[row.google_event_id] = row.assigned_user_id;
            return accumulator;
          },
          {},
        );
        const previousCountRow = await queryRow<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM ${meetingsTable}`,
          [],
          client,
        );
        const previousCount = previousCountRow?.count ?? 0;

        await execute(`DELETE FROM ${meetingsTable}`, [], client);

        const syncedAt = new Date().toISOString();

        for (const meeting of activeMeetings) {
          await execute(
            `
              INSERT INTO ${meetingsTable} (
                id,
                google_event_id,
                title,
                client_name,
                company,
                country,
                meeting_type,
                start_at_utc,
                end_at_utc,
                source_timezone,
                google_meet_url,
                google_doc_url,
                client_email,
                phone,
                company_size,
                modules_of_interest_json,
                description_raw,
                calendar_html_url,
                assigned_user_id,
                updated_at,
                last_synced_at
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
              )
            `,
            [
              nanoid(),
              meeting.googleEventId,
              meeting.title,
              meeting.clientName,
              meeting.company,
              meeting.country,
              meeting.meetingType,
              meeting.startAtUtc,
              meeting.endAtUtc,
              meeting.sourceTimezone,
              meeting.googleMeetUrl,
              meeting.googleDocUrl,
              meeting.clientEmail,
              meeting.phone,
              meeting.companySize,
              JSON.stringify(meeting.modulesOfInterest),
              meeting.descriptionRaw,
              meeting.calendarHtmlUrl,
              previousAssignments[meeting.googleEventId] ?? null,
              meeting.updatedAt,
              syncedAt,
            ],
            client,
          );
        }

        await execute(
          `
            INSERT INTO ${syncStateTable} (key, value) VALUES ('lastSuccessfulSyncAt', $1)
            ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value
          `,
          [syncedAt],
          client,
        );

        return {
          imported: activeMeetings.length,
          updated: Math.min(previousCount, activeMeetings.length),
          removed: Math.max(previousCount - activeMeetings.length, 0),
          syncedAt,
        } satisfies ReplaceMeetingsResult;
      });
    },

    async findMeetingByIdIncludingPast(meetingId) {
      const activeMeeting = await queryRow<DbMeetingWithAssignmentRow>(
        `${selectActiveMeetingsQuery} WHERE meetings.id = $1 LIMIT 1`,
        [meetingId],
      );

      if (activeMeeting) {
        return activeMeeting;
      }

      return queryRow<DbPastMeetingWithAssignmentRow>(
        `${selectPastMeetingsQuery} WHERE past_meetings.id = $1 LIMIT 1`,
        [meetingId],
      );
    },

    async getAiMeetingGuideByGoogleEventId(googleEventId) {
      return queryRow<DbAiMeetingGuideRow>(
        `SELECT * FROM ${aiMeetingGuidesTable} WHERE google_event_id = $1 LIMIT 1`,
        [googleEventId],
      );
    },

    async upsertAiMeetingGuide(row) {
      await execute(
        `
          INSERT INTO ${aiMeetingGuidesTable} (
            google_event_id,
            guide_json,
            created_by_user_id,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT(google_event_id) DO UPDATE SET
            guide_json = EXCLUDED.guide_json,
            created_by_user_id = EXCLUDED.created_by_user_id,
            updated_at = EXCLUDED.updated_at
        `,
        [
          row.google_event_id,
          row.guide_json,
          row.created_by_user_id,
          row.created_at,
          row.updated_at,
        ],
      );
    },

    async deleteAiMeetingGuideByGoogleEventId(googleEventId) {
      await execute(`DELETE FROM ${aiMeetingGuidesTable} WHERE google_event_id = $1`, [
        googleEventId,
      ]);
    },

    async insertAiPostImageGeneration(row) {
      await execute(
        `
          INSERT INTO ${aiPostImageGenerationsTable} (
            id,
            conversation_id,
            prompt,
            caption,
            tags_json,
            image_name,
            image_model,
            created_by_user_id,
            created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          row.id,
          row.conversation_id,
          row.prompt,
          row.caption,
          row.tags_json,
          row.image_name,
          row.image_model,
          row.created_by_user_id,
          row.created_at,
        ],
      );
    },

    async listRecentAiPostImageGenerations(conversationId, userId, limit) {
      return queryRows<DbAiPostImageGenerationRow>(
        `
          SELECT *
          FROM ${aiPostImageGenerationsTable}
          WHERE conversation_id = $1
            AND created_by_user_id = $2
          ORDER BY created_at DESC
          LIMIT $3
        `,
        [conversationId, userId, limit],
      );
    },

    async insertAiPostCaptionGeneration(row) {
      await execute(
        `
          INSERT INTO ${aiPostCaptionGenerationsTable} (
            id, conversation_id, prompt, platform, caption, hashtags_json,
            model, created_by_user_id, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          row.id,
          row.conversation_id,
          row.prompt,
          row.platform,
          row.caption,
          row.hashtags_json,
          row.model,
          row.created_by_user_id,
          row.created_at,
        ],
      );
    },

    async listRecentAiPostCaptionGenerations(userId, limit) {
      return queryRows<DbAiPostCaptionGenerationRow>(
        `
          SELECT *
          FROM ${aiPostCaptionGenerationsTable}
          WHERE created_by_user_id = $1
          ORDER BY created_at DESC
          LIMIT $2
        `,
        [userId, limit],
      );
    },

    async listPostsForAccounts(accountIds, statuses, perAccountLimit) {
      if (!accountIds.length || !statuses.length) {
        return [];
      }

      // Window function caps rows PER account so per-account history is bounded.
      return queryRows<DbScheduledSocialPostWithCreatorRow>(
        `SELECT * FROM (
           SELECT
             scheduled_social_posts.*,
             users.display_name AS created_by_user_name,
             ROW_NUMBER() OVER (
               PARTITION BY scheduled_social_posts.account_id
               ORDER BY COALESCE(
                 scheduled_social_posts.published_at,
                 scheduled_social_posts.created_at
               ) DESC, scheduled_social_posts.id DESC
             ) AS rn
           FROM ${scheduledSocialPostsTable} AS scheduled_social_posts
           LEFT JOIN ${usersTable} AS users
             ON users.id = scheduled_social_posts.created_by_user_id
           WHERE scheduled_social_posts.account_id = ANY($1)
             AND scheduled_social_posts.status = ANY($2)
         ) sub
         WHERE rn <= $3
         ORDER BY account_id, COALESCE(published_at, created_at) DESC, id DESC`,
        [accountIds, statuses, perAccountLimit],
      );
    },

    async listPublishedSocialPosts(limit) {
      return queryRows<DbScheduledSocialPostWithCreatorRow>(
        `${selectScheduledSocialPostsQuery}
         WHERE scheduled_social_posts.status = 'published'
         ORDER BY scheduled_social_posts.published_at DESC
         LIMIT $1`,
        [limit],
      );
    },

    async insertMeetingRequest(row) {
      await execute(
        `
          INSERT INTO ${meetingRequestsTable} (
            id,
            client_name,
            email,
            phone,
            company_name,
            country,
            business_size,
            modules_json,
            meeting_mode,
            preferred_date,
            preferred_time,
            additional_info,
            created_by_user_id,
            created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12, $13, $14
          )
        `,
        [
          row.id,
          row.client_name,
          row.email,
          row.phone,
          row.company_name,
          row.country,
          row.business_size,
          row.modules_json,
          row.meeting_mode,
          row.preferred_date,
          row.preferred_time,
          row.additional_info,
          row.created_by_user_id,
          row.created_at,
        ],
      );
    },

    async findMeetingRequestById(id) {
      return queryRow<DbMeetingRequestRow>(
        `SELECT * FROM ${meetingRequestsTable} WHERE id = $1 LIMIT 1`,
        [id],
      );
    },

    async deleteMeetingRequestById(id) {
      await execute(`DELETE FROM ${meetingRequestsTable} WHERE id = $1`, [id]);
    },

    async insertLoftBooking(row) {
      await execute(
        `
          INSERT INTO ${loftBookingsTable} (
            id,
            name,
            business,
            email,
            phone,
            message,
            submitted_at,
            created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8
          )
        `,
        [
          row.id,
          row.name,
          row.business,
          row.email,
          row.phone,
          row.message,
          row.submitted_at,
          row.created_at,
        ],
      );
    },

    async listLoftBookings() {
      return queryRows<DbLoftBookingRow>(
        `SELECT * FROM ${loftBookingsTable} ORDER BY submitted_at DESC`,
      );
    },

    async hasLoftAccess(userId) {
      const row = await queryRow<{ user_id: string }>(
        `SELECT user_id FROM ${loftAccessTable} WHERE user_id = $1 LIMIT 1`,
        [userId],
      );

      return Boolean(row);
    },

    async grantLoftAccess(userId) {
      await execute(
        `
          INSERT INTO ${loftAccessTable} (user_id, granted_at)
          VALUES ($1, $2)
          ON CONFLICT (user_id) DO NOTHING
        `,
        [userId, new Date().toISOString()],
      );
    },

    async listCallingProspects() {
      return queryRows<DbCallingProspectRow>(
        `SELECT * FROM ${callingProspectsTable} ORDER BY updated_at DESC, name ASC`,
      );
    },

    async findCallingProspectById(id) {
      return queryRow<DbCallingProspectRow>(
        `SELECT * FROM ${callingProspectsTable} WHERE id = $1 LIMIT 1`,
        [id],
      );
    },

    async insertCallingProspect(row) {
      await execute(
        `
          INSERT INTO ${callingProspectsTable} (
            id,
            name,
            phone,
            company_name,
            email,
            notes,
            source,
            external_id,
            status,
            last_call_at,
            last_call_outcome,
            created_by_user_id,
            created_at,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12, $13, $14
          )
        `,
        [
          row.id,
          row.name,
          row.phone,
          row.company_name,
          row.email,
          row.notes,
          row.source,
          row.external_id,
          row.status,
          row.last_call_at,
          row.last_call_outcome,
          row.created_by_user_id,
          row.created_at,
          row.updated_at,
        ],
      );
    },

    async upsertCallingProspects(rows) {
      return withTransaction(async (client) => {
        const syncedAt = new Date().toISOString();

        if (!rows.length) {
          await execute(
            `
              INSERT INTO ${syncStateTable} (key, value) VALUES ('lastCallingSheetSyncAt', $1)
              ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value
            `,
            [syncedAt],
            client,
          );

          return { imported: 0, updated: 0, skipped: 0, syncedAt };
        }

        const externalIds = rows
          .map((row) => row.external_id)
          .filter((externalId): externalId is string => Boolean(externalId));
        const existingRows = externalIds.length
          ? await queryRows<{ external_id: string }>(
              `SELECT external_id FROM ${callingProspectsTable} WHERE external_id = ANY($1)`,
              [externalIds],
              client,
            )
          : [];
        const existing = new Set(existingRows.map((row) => row.external_id));
        let imported = 0;
        let updated = 0;

        for (const row of rows) {
          if (row.external_id && existing.has(row.external_id)) {
            await execute(
              `
                UPDATE ${callingProspectsTable}
                SET
                  name = $1,
                  phone = $2,
                  company_name = $3,
                  email = $4,
                  notes = $5,
                  source = $6,
                  updated_at = $7
                WHERE external_id = $8
              `,
              [
                row.name,
                row.phone,
                row.company_name,
                row.email,
                row.notes,
                row.source,
                syncedAt,
                row.external_id,
              ],
              client,
            );
            updated += 1;
            continue;
          }

          await execute(
            `
              INSERT INTO ${callingProspectsTable} (
                id,
                name,
                phone,
                company_name,
                email,
                notes,
                source,
                external_id,
                status,
                last_call_at,
                last_call_outcome,
                created_by_user_id,
                created_at,
                updated_at
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13, $14
              )
            `,
            [
              row.id,
              row.name,
              row.phone,
              row.company_name,
              row.email,
              row.notes,
              row.source,
              row.external_id,
              row.status,
              row.last_call_at,
              row.last_call_outcome,
              row.created_by_user_id,
              row.created_at,
              row.updated_at,
            ],
            client,
          );
          imported += 1;
        }

        await execute(
          `
            INSERT INTO ${syncStateTable} (key, value) VALUES ('lastCallingSheetSyncAt', $1)
            ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value
          `,
          [syncedAt],
          client,
        );

        return {
          imported,
          updated,
          skipped: 0,
          syncedAt,
        } satisfies UpsertCallingProspectsResult;
      });
    },

    async updateCallingProspectStatus(prospectId, patch) {
      const updatedAt = new Date().toISOString();
      const result = await execute(
        `
          UPDATE ${callingProspectsTable}
          SET
            status = $1,
            last_call_at = COALESCE($2, last_call_at),
            last_call_outcome = COALESCE($3, last_call_outcome),
            updated_at = $4
          WHERE id = $5
        `,
        [
          patch.status,
          patch.lastCallAt ?? null,
          patch.lastCallOutcome ?? null,
          updatedAt,
          prospectId,
        ],
      );

      if (!(result.rowCount ?? 0)) {
        return null;
      }

      return queryRow<DbCallingProspectRow>(
        `SELECT * FROM ${callingProspectsTable} WHERE id = $1 LIMIT 1`,
        [prospectId],
      );
    },

    async listCallingBatches(limit) {
      return queryRows<DbCallingBatchRow>(
        `SELECT * FROM ${callingBatchesTable} ORDER BY created_at DESC LIMIT $1`,
        [limit],
      );
    },

    async findCallingBatchById(id) {
      return queryRow<DbCallingBatchRow>(
        `SELECT * FROM ${callingBatchesTable} WHERE id = $1 LIMIT 1`,
        [id],
      );
    },

    async insertCallingBatch(batch, calls) {
      await withTransaction(async (client) => {
        await execute(
          `
            INSERT INTO ${callingBatchesTable} (
              id,
              status,
              total_count,
              created_by_user_id,
              created_at,
              started_at,
              completed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            batch.id,
            batch.status,
            batch.total_count,
            batch.created_by_user_id,
            batch.created_at,
            batch.started_at,
            batch.completed_at,
          ],
          client,
        );

        for (const call of calls) {
          await execute(
            `
              INSERT INTO ${callingCallsTable} (
                id,
                batch_id,
                prospect_id,
                sequence_index,
                status,
                outcome,
                notes,
                duration_seconds,
                external_call_id,
                status_message,
                created_at,
                started_at,
                completed_at,
                updated_at
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13, $14
              )
            `,
            [
              call.id,
              call.batch_id,
              call.prospect_id,
              call.sequence_index,
              call.status,
              call.outcome,
              call.notes,
              call.duration_seconds,
              call.external_call_id,
              call.status_message,
              call.created_at,
              call.started_at,
              call.completed_at,
              call.updated_at,
            ],
            client,
          );
          await execute(
            `
              UPDATE ${callingProspectsTable}
              SET status = 'queued', updated_at = $1
              WHERE id = $2 AND status != 'do_not_call'
            `,
            [batch.created_at, call.prospect_id],
            client,
          );
        }
      });
    },

    async updateCallingBatchStatus(batchId, patch) {
      const result = await execute(
        `
          UPDATE ${callingBatchesTable}
          SET
            status = $1,
            started_at = COALESCE(started_at, $2),
            completed_at = COALESCE($3, completed_at)
          WHERE id = $4
        `,
        [
          patch.status,
          patch.startedAt ?? null,
          patch.completedAt ?? null,
          batchId,
        ],
      );

      if (!(result.rowCount ?? 0)) {
        return null;
      }

      return queryRow<DbCallingBatchRow>(
        `SELECT * FROM ${callingBatchesTable} WHERE id = $1 LIMIT 1`,
        [batchId],
      );
    },

    async listCallingCalls(limit) {
      return queryRows<DbCallingCallRow>(
        `SELECT * FROM ${callingCallsTable} ORDER BY created_at DESC, sequence_index ASC LIMIT $1`,
        [limit],
      );
    },

    async listCallingCallsByBatch(batchId) {
      return queryRows<DbCallingCallRow>(
        `SELECT * FROM ${callingCallsTable} WHERE batch_id = $1 ORDER BY sequence_index ASC`,
        [batchId],
      );
    },

    async findCallingCallById(id) {
      return queryRow<DbCallingCallRow>(
        `SELECT * FROM ${callingCallsTable} WHERE id = $1 LIMIT 1`,
        [id],
      );
    },

    async findNextQueuedCallingCall(batchId) {
      return queryRow<DbCallingCallRow>(
        `
          SELECT *
          FROM ${callingCallsTable}
          WHERE batch_id = $1 AND status = 'queued'
          ORDER BY sequence_index ASC
          LIMIT 1
        `,
        [batchId],
      );
    },

    async updateCallingCallStatus(callId, patch) {
      const updatedAt = new Date().toISOString();
      const result = await execute(
        `
          UPDATE ${callingCallsTable}
          SET
            status = $1,
            outcome = COALESCE($2, outcome),
            notes = COALESCE($3, notes),
            duration_seconds = COALESCE($4, duration_seconds),
            external_call_id = COALESCE($5, external_call_id),
            status_message = $6,
            started_at = COALESCE(started_at, $7),
            completed_at = COALESCE($8, completed_at),
            updated_at = $9
          WHERE id = $10
        `,
        [
          patch.status,
          patch.outcome ?? null,
          patch.notes ?? null,
          patch.durationSeconds ?? null,
          patch.externalCallId ?? null,
          patch.statusMessage ?? null,
          patch.startedAt ?? null,
          patch.completedAt ?? null,
          updatedAt,
          callId,
        ],
      );

      if (!(result.rowCount ?? 0)) {
        return null;
      }

      return queryRow<DbCallingCallRow>(
        `SELECT * FROM ${callingCallsTable} WHERE id = $1 LIMIT 1`,
        [callId],
      );
    },

    async getLastCallingSheetSyncAt() {
      const row = await queryRow<{ value: string }>(
        `SELECT value FROM ${syncStateTable} WHERE key = 'lastCallingSheetSyncAt' LIMIT 1`,
      );
      return row?.value ?? null;
    },

    async insertScheduledSocialPosts(rows) {
      await withTransaction(async (client) => {
        for (const row of rows) {
          await execute(
            `
              INSERT INTO ${scheduledSocialPostsTable} (
                id,
                platform,
                account_id,
                caption,
                image_data_url,
                image_name,
                thumbnail_data_url,
                scheduled_for,
                timezone,
                status,
                status_message,
                external_post_id,
                published_at,
                created_by_user_id,
                created_at,
                updated_at
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $11, $12, $13, $14, $15, $16
              )
            `,
            [
              row.id,
              row.platform,
              row.account_id,
              row.caption,
              row.image_data_url,
              row.image_name,
              row.thumbnail_data_url,
              row.scheduled_for,
              row.timezone,
              row.status,
              row.status_message,
              row.external_post_id,
              row.published_at,
              row.created_by_user_id,
              row.created_at,
              row.updated_at,
            ],
            client,
          );
        }
      });
    },

    async listScheduledSocialPosts() {
      return queryRows<DbScheduledSocialPostWithCreatorRow>(
        `${selectScheduledSocialPostsQuery}
         ORDER BY scheduled_social_posts.scheduled_for ASC, scheduled_social_posts.created_at ASC`,
      );
    },

    async findScheduledSocialPostById(id) {
      return queryRow<DbScheduledSocialPostWithCreatorRow>(
        `${selectScheduledSocialPostsQuery} WHERE scheduled_social_posts.id = $1 LIMIT 1`,
        [id],
      );
    },

    async listDueScheduledSocialPosts(nowIso, limit) {
      return queryRows<DbScheduledSocialPostWithCreatorRow>(
        `${selectScheduledSocialPostsQuery}
         WHERE scheduled_social_posts.status = 'scheduled'
           AND scheduled_social_posts.scheduled_for <= $1
         ORDER BY scheduled_social_posts.scheduled_for ASC
         LIMIT $2`,
        [nowIso, limit],
      );
    },

    async rescheduleScheduledSocialPost(id, scheduledFor, timezone) {
      await execute(
        `
          UPDATE ${scheduledSocialPostsTable}
          SET
            scheduled_for = $1,
            timezone = $2,
            status = 'scheduled',
            status_message = 'Waiting for scheduled publish time.',
            published_at = NULL,
            updated_at = $3
          WHERE id = $4
            AND status IN ('scheduled', 'failed', 'connection_required')
        `,
        [scheduledFor, timezone, new Date().toISOString(), id],
      );

      return queryRow<DbScheduledSocialPostWithCreatorRow>(
        `${selectScheduledSocialPostsQuery} WHERE scheduled_social_posts.id = $1 LIMIT 1`,
        [id],
      );
    },

    async deleteScheduledSocialPost(id) {
      const result = await execute(
        `
          DELETE FROM ${scheduledSocialPostsTable}
          WHERE id = $1
            AND status IN ('scheduled', 'failed', 'connection_required', 'cancelled', 'pending_review')
        `,
        [id],
      );

      return (result.rowCount ?? 0) > 0;
    },

    async updateScheduledSocialPostCaption(id, caption) {
      const result = await execute(
        `
          UPDATE ${scheduledSocialPostsTable}
          SET caption = $1, updated_at = $2
          WHERE id = $3
            AND status IN ('scheduled', 'failed', 'connection_required', 'pending_review')
        `,
        [caption, new Date().toISOString(), id],
      );

      // Status guard rejected the edit (or no such post): report no row so the
      // caller returns a clear 404 instead of a misleading success.
      if ((result.rowCount ?? 0) === 0) {
        return null;
      }

      return queryRow<DbScheduledSocialPostWithCreatorRow>(
        `${selectScheduledSocialPostsQuery} WHERE scheduled_social_posts.id = $1 LIMIT 1`,
        [id],
      );
    },

    async approvePendingSocialPost(id, scheduledFor, timezone) {
      await execute(
        `
          UPDATE ${scheduledSocialPostsTable}
          SET
            scheduled_for = $1,
            timezone = $2,
            status = 'scheduled',
            status_message = 'Approved — waiting for scheduled publish time.',
            published_at = NULL,
            updated_at = $3
          WHERE id = $4
            AND status = 'pending_review'
        `,
        [scheduledFor, timezone, new Date().toISOString(), id],
      );

      return queryRow<DbScheduledSocialPostWithCreatorRow>(
        `${selectScheduledSocialPostsQuery} WHERE scheduled_social_posts.id = $1 LIMIT 1`,
        [id],
      );
    },

    async updateScheduledSocialPostStatus(id, status, patch = {}) {
      await execute(
        `
          UPDATE ${scheduledSocialPostsTable}
          SET
            status = $1,
            status_message = $2,
            external_post_id = COALESCE($3, external_post_id),
            published_at = $4,
            updated_at = $5
          WHERE id = $6
        `,
        [
          status,
          patch.statusMessage ?? null,
          patch.externalPostId ?? null,
          patch.publishedAt ?? null,
          new Date().toISOString(),
          id,
        ],
      );

      return queryRow<DbScheduledSocialPostWithCreatorRow>(
        `${selectScheduledSocialPostsQuery} WHERE scheduled_social_posts.id = $1 LIMIT 1`,
        [id],
      );
    },

    async upsertSocialAccount(row) {
      await execute(
        `
          INSERT INTO ${socialAccountsTable} (
            id,
            platform,
            display_name,
            account_id,
            access_token,
            token_type,
            expires_at,
            scopes,
            metadata_json,
            active,
            created_by_user_id,
            created_at,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12, $13
          )
          ON CONFLICT(id) DO UPDATE SET
            platform = EXCLUDED.platform,
            display_name = EXCLUDED.display_name,
            account_id = EXCLUDED.account_id,
            access_token = EXCLUDED.access_token,
            token_type = EXCLUDED.token_type,
            expires_at = EXCLUDED.expires_at,
            scopes = EXCLUDED.scopes,
            metadata_json = EXCLUDED.metadata_json,
            active = EXCLUDED.active,
            created_by_user_id = EXCLUDED.created_by_user_id,
            updated_at = EXCLUDED.updated_at
        `,
        [
          row.id,
          row.platform,
          row.display_name,
          row.account_id,
          row.access_token,
          row.token_type,
          row.expires_at,
          row.scopes,
          row.metadata_json,
          row.active,
          row.created_by_user_id,
          row.created_at,
          row.updated_at,
        ],
      );
    },

    async listSocialAccounts() {
      return queryRows<DbSocialAccountWithCreatorRow>(
        `${selectSocialAccountsQuery}
         WHERE social_accounts.active = 1
         ORDER BY social_accounts.platform ASC`,
      );
    },

    async findSocialAccountByPlatform(platform: DbSocialPlatform) {
      return queryRow<DbSocialAccountWithCreatorRow>(
        `${selectSocialAccountsQuery}
         WHERE social_accounts.platform = $1
           AND social_accounts.active = 1
         LIMIT 1`,
        [platform],
      );
    },

    async findSocialAccountById(id: string) {
      return queryRow<DbSocialAccountWithCreatorRow>(
        `${selectSocialAccountsQuery}
         WHERE social_accounts.id = $1
           AND social_accounts.active = 1
         LIMIT 1`,
        [id],
      );
    },

    async updateSocialAccountTokens(id, patch) {
      await execute(
        `UPDATE ${socialAccountsTable}
         SET access_token = $2, expires_at = $3, metadata_json = $4, updated_at = $5
         WHERE id = $1`,
        [id, patch.accessToken, patch.expiresAt, patch.metadataJson, new Date().toISOString()],
      );
    },

    async deleteSocialAccount(id) {
      const result = await execute(`DELETE FROM ${socialAccountsTable} WHERE id = $1`, [
        id,
      ]);
      return (result.rowCount ?? 0) > 0;
    },

    async getAutoPostAgentConfig() {
      return queryRow<DbAutoPostAgentConfigRow>(
        `SELECT * FROM ${autoPostAgentConfigTable} WHERE id = 'default' LIMIT 1`,
        [],
      );
    },

    async upsertAutoPostAgentConfig(row) {
      await execute(
        `
          INSERT INTO ${autoPostAgentConfigTable} (
            id, enabled, cadence_json, posts_per_run, target_account_ids_json,
            image_style, timezone, last_run_at, slot_runs_json,
            updated_by_user_id, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT(id) DO UPDATE SET
            enabled = EXCLUDED.enabled,
            cadence_json = EXCLUDED.cadence_json,
            posts_per_run = EXCLUDED.posts_per_run,
            target_account_ids_json = EXCLUDED.target_account_ids_json,
            image_style = EXCLUDED.image_style,
            timezone = EXCLUDED.timezone,
            last_run_at = EXCLUDED.last_run_at,
            slot_runs_json = EXCLUDED.slot_runs_json,
            updated_by_user_id = EXCLUDED.updated_by_user_id,
            updated_at = EXCLUDED.updated_at
        `,
        [
          row.id,
          row.enabled,
          row.cadence_json,
          row.posts_per_run,
          row.target_account_ids_json,
          row.image_style,
          row.timezone,
          row.last_run_at,
          row.slot_runs_json,
          row.updated_by_user_id,
          row.updated_at,
        ],
      );
    },

    async claimAutoPostAgentSlot(slotId, expectedLastFiredAt, nowIso) {
      // One atomic statement: the jsonb merge sets just this slot's key, and the
      // WHERE clause is the compare-and-swap (key absent when expected null, else
      // current value matches). Safe across concurrent ticks/instances.
      const result = await execute(
        `UPDATE ${autoPostAgentConfigTable}
         SET slot_runs_json = (
               slot_runs_json::jsonb || jsonb_build_object($1::text, $2::text)
             )::text,
             last_run_at = $2
         WHERE id = 'default'
           AND (
             -- Treat key-absent and key-present-with-JSON-null identically,
             -- mirroring the SQLite adapter's null-coalescing semantics.
             ($3::text IS NULL AND (
               NOT (slot_runs_json::jsonb ? $1)
               OR (slot_runs_json::jsonb -> $1) = 'null'::jsonb
             ))
             OR (slot_runs_json::jsonb ->> $1) = $3
           )`,
        [slotId, nowIso, expectedLastFiredAt],
      );

      return (result.rowCount ?? 0) > 0;
    },
  };
};

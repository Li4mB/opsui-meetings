import argon2 from "argon2";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import type {
  DbAiMeetingGuideRow,
  DbMeetingRequestRow,
  DbMeetingRow,
  DbUserRow,
} from "../types.js";
import type {
  DbMeetingFilters,
  DbMeetingWithAssignmentRow,
  DbPastMeetingWithAssignmentRow,
  ReplaceMeetingsResult,
  StorageAdapter,
} from "./adapter.js";

const schemaName = env.dbSchema;
const usersTable = `${schemaName}.users`;
const meetingsTable = `${schemaName}.meetings`;
const pastMeetingsTable = `${schemaName}.past_meetings`;
const syncStateTable = `${schemaName}.sync_state`;
const aiMeetingGuidesTable = `${schemaName}.ai_meeting_guides`;
const meetingRequestsTable = `${schemaName}.meeting_requests`;

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
  };
};

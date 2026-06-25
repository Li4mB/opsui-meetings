import fs from "node:fs";
import path from "node:path";
import argon2 from "argon2";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import type {
  CalendarMeeting,
  DbAiMeetingGuideRow,
  DbAiPostCaptionGenerationRow,
  DbAiPostImageGenerationRow,
  DbAutoPostAgentConfigRow,
  DbCallingBatchRow,
  DbCallingCallRow,
  DbCallingProspectRow,
  DbCallingSheetSourceRow,
  DbLoftBookingRow,
  DbMeetingRequestRow,
  DbMeetingRow,
  DbScheduledSocialPostRow,
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

const ensureDirectory = (filePath: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const schemaSql = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
    password_hash TEXT NOT NULL,
    color_hex TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meetings (
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
    FOREIGN KEY (assigned_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS past_meetings (
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
    resolved_at TEXT NOT NULL,
    FOREIGN KEY (assigned_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_meeting_guides (
    google_event_id TEXT PRIMARY KEY,
    guide_json TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS ai_post_image_generations (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    caption TEXT,
    tags_json TEXT NOT NULL,
    image_name TEXT NOT NULL,
    image_model TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_ai_post_image_generations_context
    ON ai_post_image_generations(conversation_id, created_by_user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS ai_post_caption_generations (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    platform TEXT NOT NULL,
    caption TEXT NOT NULL,
    hashtags_json TEXT NOT NULL,
    model TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_ai_post_caption_generations_context
    ON ai_post_caption_generations(created_by_user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS auto_post_agent_config (
    id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    cadence_json TEXT NOT NULL DEFAULT '{}',
    posts_per_run INTEGER NOT NULL DEFAULT 1,
    target_account_ids_json TEXT NOT NULL DEFAULT '[]',
    image_style TEXT NOT NULL DEFAULT 'realistic',
    timezone TEXT NOT NULL DEFAULT 'Local timezone',
    last_run_at TEXT,
    slot_runs_json TEXT NOT NULL DEFAULT '{}',
    updated_by_user_id TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS meeting_requests (
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
    created_at TEXT NOT NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS scheduled_social_posts (
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
    updated_at TEXT NOT NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_scheduled_social_posts_due
    ON scheduled_social_posts(status, scheduled_for);

  CREATE TABLE IF NOT EXISTS social_accounts (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL CHECK(platform IN ('facebook', 'linkedin', 'twitter', 'instagram')),
    display_name TEXT NOT NULL,
    account_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    token_type TEXT,
    expires_at TEXT,
    scopes TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    active INTEGER NOT NULL DEFAULT 1,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_social_accounts_platform
    ON social_accounts(platform, active);

  CREATE TABLE IF NOT EXISTS loft_bookings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    business TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    submitted_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS loft_access (
    user_id TEXT PRIMARY KEY,
    granted_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS calling_prospects (
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
    updated_at TEXT NOT NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_calling_prospects_status
    ON calling_prospects(status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS calling_batches (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')) DEFAULT 'queued',
    total_count INTEGER NOT NULL,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_calling_batches_status
    ON calling_batches(status, created_at DESC);

  CREATE TABLE IF NOT EXISTS calling_calls (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    prospect_id TEXT NOT NULL,
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
    updated_at TEXT NOT NULL,
    FOREIGN KEY (batch_id) REFERENCES calling_batches(id) ON DELETE CASCADE,
    FOREIGN KEY (prospect_id) REFERENCES calling_prospects(id)
  );

  CREATE INDEX IF NOT EXISTS idx_calling_calls_batch
    ON calling_calls(batch_id, sequence_index);

  CREATE INDEX IF NOT EXISTS idx_calling_calls_status
    ON calling_calls(status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS calling_sheet_sources (
    id TEXT PRIMARY KEY,
    spreadsheet_id TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_calling_sheet_sources_created
    ON calling_sheet_sources(created_at DESC);
`;

const selectActiveMeetingsQuery = `
  SELECT
    meetings.*,
    users.display_name AS assigned_user_name,
    users.color_hex AS assigned_user_color
  FROM meetings
  LEFT JOIN users ON users.id = meetings.assigned_user_id
`;

const selectPastMeetingsQuery = `
  SELECT
    past_meetings.*,
    users.display_name AS assigned_user_name,
    users.color_hex AS assigned_user_color
  FROM past_meetings
  LEFT JOIN users ON users.id = past_meetings.assigned_user_id
`;

const selectScheduledSocialPostsQuery = `
  SELECT
    scheduled_social_posts.*,
    users.display_name AS created_by_user_name
  FROM scheduled_social_posts
  LEFT JOIN users ON users.id = scheduled_social_posts.created_by_user_id
`;

const selectSocialAccountsQuery = `
  SELECT
    social_accounts.*,
    users.display_name AS created_by_user_name
  FROM social_accounts
  LEFT JOIN users ON users.id = social_accounts.created_by_user_id
`;

const buildWhereClause = (tableName: "meetings" | "past_meetings", filters: DbMeetingFilters) => {
  const clauses: string[] = [];
  const params: string[] = [];

  if (filters.country) {
    clauses.push(`${tableName}.country = ?`);
    params.push(filters.country);
  }

  if (filters.assignedUserId) {
    clauses.push(`${tableName}.assigned_user_id = ?`);
    params.push(filters.assignedUserId);
  }

  if (filters.from) {
    clauses.push(`${tableName}.start_at_utc >= ?`);
    params.push(filters.from);
  }

  if (filters.to) {
    clauses.push(`${tableName}.start_at_utc <= ?`);
    params.push(filters.to);
  }

  return {
    params,
    whereClause: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
  };
};

export const createSqliteAdapter = (): StorageAdapter => {
  let db: Database.Database | null = null;

  const getDb = () => {
    if (!db) {
      throw new Error("SQLite storage has not been initialized.");
    }

    return db;
  };

  const ensureColumn = (
    database: Database.Database,
    tableName: string,
    columnName: string,
    columnDefinition: string,
  ) => {
    const columns = database
      .prepare<[], { name: string }>(`PRAGMA table_info(${tableName})`)
      .all()
      .map((row) => row.name);

    if (!columns.includes(columnName)) {
      database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
    }
  };

  // Older databases created social_accounts with `platform ... UNIQUE`, which
  // blocks connecting more than one account per platform. SQLite cannot drop a
  // column constraint in place, so rebuild the table without the UNIQUE index
  // when the legacy unique constraint (PRAGMA origin "u") is present.
  const dropSocialAccountsPlatformUnique = (database: Database.Database) => {
    const indexes = database
      .prepare<[], { unique: number; origin: string }>(
        `PRAGMA index_list('social_accounts')`,
      )
      .all();
    const hasUniqueConstraint = indexes.some(
      (index) => index.unique === 1 && index.origin === "u",
    );

    if (!hasUniqueConstraint) {
      return;
    }

    database.pragma("foreign_keys = OFF");
    database.exec(`
      CREATE TABLE social_accounts_new (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL CHECK(platform IN ('facebook', 'linkedin', 'twitter', 'instagram')),
        display_name TEXT NOT NULL,
        account_id TEXT NOT NULL,
        access_token TEXT NOT NULL,
        token_type TEXT,
        expires_at TEXT,
        scopes TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        active INTEGER NOT NULL DEFAULT 1,
        created_by_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id)
      );
      INSERT INTO social_accounts_new (
        id, platform, display_name, account_id, access_token, token_type,
        expires_at, scopes, metadata_json, active, created_by_user_id,
        created_at, updated_at
      )
      SELECT
        id, platform, display_name, account_id, access_token, token_type,
        expires_at, scopes, metadata_json, active, created_by_user_id,
        created_at, updated_at
      FROM social_accounts;
      DROP TABLE social_accounts;
      ALTER TABLE social_accounts_new RENAME TO social_accounts;
      CREATE INDEX IF NOT EXISTS idx_social_accounts_platform
        ON social_accounts(platform, active);
    `);
    database.pragma("foreign_keys = ON");
  };

  // Older databases created scheduled_social_posts with a status CHECK that
  // omits 'pending_review'. SQLite can't alter a CHECK in place, so rebuild the
  // table with the widened CHECK when the stored DDL lacks the new status.
  const migrateScheduledPostsStatusCheck = (database: Database.Database) => {
    const row = database
      .prepare<[], { sql: string | null }>(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_social_posts'`,
      )
      .get();

    if (!row?.sql || row.sql.includes("pending_review")) {
      return;
    }

    database.pragma("foreign_keys = OFF");
    database.exec(`
      CREATE TABLE scheduled_social_posts_new (
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
        updated_at TEXT NOT NULL,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id)
      );
      INSERT INTO scheduled_social_posts_new (
        id, platform, account_id, caption, image_data_url, image_name,
        thumbnail_data_url, scheduled_for, timezone, status, status_message,
        external_post_id, published_at, created_by_user_id, created_at, updated_at
      )
      SELECT
        id, platform, account_id, caption, image_data_url, image_name,
        thumbnail_data_url, scheduled_for, timezone, status, status_message,
        external_post_id, published_at, created_by_user_id, created_at, updated_at
      FROM scheduled_social_posts;
      DROP TABLE scheduled_social_posts;
      ALTER TABLE scheduled_social_posts_new RENAME TO scheduled_social_posts;
      CREATE INDEX IF NOT EXISTS idx_scheduled_social_posts_due
        ON scheduled_social_posts(status, scheduled_for);
    `);
    database.pragma("foreign_keys = ON");
  };

  return {
    async initialize() {
      if (db) {
        return;
      }

      ensureDirectory(env.dbPath);
      db = new Database(env.dbPath);
      db.pragma("journal_mode = WAL");
      db.exec(schemaSql);
      ensureColumn(
        db,
        "meeting_requests",
        "country",
        "country TEXT NOT NULL DEFAULT 'Unknown'",
      );
      ensureColumn(db, "scheduled_social_posts", "account_id", "account_id TEXT");
      ensureColumn(
        db,
        "auto_post_agent_config",
        "slot_runs_json",
        "slot_runs_json TEXT NOT NULL DEFAULT '{}'",
      );
      dropSocialAccountsPlatformUnique(db);
      migrateScheduledPostsStatusCheck(db);
    },

    async close() {
      if (db) {
        db.close();
        db = null;
      }
    },

    async seedAdminIfMissing() {
      const database = getDb();
      const existing = database
        .prepare("SELECT id FROM users WHERE username = ? LIMIT 1")
        .get(env.seedAdminUsername);

      if (existing) {
        return;
      }

      const timestamp = new Date().toISOString();
      const passwordHash = await argon2.hash(env.seedAdminPassword);

      database.prepare(`
        INSERT INTO users (
          id,
          username,
          display_name,
          role,
          password_hash,
          color_hex,
          active,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        nanoid(),
        env.seedAdminUsername,
        env.seedAdminDisplayName,
        "admin",
        passwordHash,
        "#4FD1C5",
        timestamp,
        timestamp,
      );
    },

    async findActiveUserByUsername(username) {
      const database = getDb();
      return (
        database
          .prepare<unknown[], DbUserRow>(
            "SELECT * FROM users WHERE username = ? AND active = 1 LIMIT 1",
          )
          .get(username) ?? null
      );
    },

    async findUserById(id) {
      const database = getDb();
      return (
        database
          .prepare<unknown[], DbUserRow>("SELECT * FROM users WHERE id = ? LIMIT 1")
          .get(id) ?? null
      );
    },

    async findUserIdByUsername(username) {
      const database = getDb();
      return (
        database
          .prepare<unknown[], { id: string }>(
            "SELECT id FROM users WHERE username = ? LIMIT 1",
          )
          .get(username) ?? null
      );
    },

    async listUsers() {
      const database = getDb();
      return database
        .prepare<unknown[], DbUserRow>("SELECT * FROM users ORDER BY display_name ASC")
        .all();
    },

    async insertUser(user) {
      const database = getDb();
      database.prepare(`
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
    },

    async updateUser(user) {
      const database = getDb();
      database.prepare(`
        UPDATE users
        SET username = ?, display_name = ?, role = ?, password_hash = ?, color_hex = ?, active = ?, updated_at = ?
        WHERE id = ?
      `).run(
        user.username,
        user.display_name,
        user.role,
        user.password_hash,
        user.color_hex,
        user.active,
        user.updated_at,
        user.id,
      );
    },

    async clearMeetingAssignmentsForUser(userId) {
      const database = getDb();
      database
        .prepare("UPDATE meetings SET assigned_user_id = NULL WHERE assigned_user_id = ?")
        .run(userId);
    },

    async deleteUserById(userId) {
      const database = getDb();
      const result = database.prepare("DELETE FROM users WHERE id = ?").run(userId);
      return result.changes > 0;
    },

    async listMeetings(filters) {
      const database = getDb();
      const { params, whereClause } = buildWhereClause("meetings", filters);
      return database
        .prepare<unknown[], DbMeetingWithAssignmentRow>(
          `${selectActiveMeetingsQuery}${whereClause} ORDER BY meetings.start_at_utc ASC`,
        )
        .all(...params);
    },

    async listPastMeetings(filters) {
      const database = getDb();
      const { params, whereClause } = buildWhereClause("past_meetings", filters);
      return database
        .prepare<unknown[], DbPastMeetingWithAssignmentRow>(
          `${selectPastMeetingsQuery}${whereClause} ORDER BY past_meetings.start_at_utc DESC`,
        )
        .all(...params);
    },

    async getLastSuccessfulSyncAt() {
      const database = getDb();
      return (
        (
          database
            .prepare<[], { value?: string }>(
              "SELECT value FROM sync_state WHERE key = 'lastSuccessfulSyncAt' LIMIT 1",
            )
            .get() as { value?: string } | undefined
        )?.value ?? null
      );
    },

    async updateMeetingAssignment(meetingId, assignedUserId) {
      const database = getDb();
      const result = database
        .prepare("UPDATE meetings SET assigned_user_id = ? WHERE id = ?")
        .run(assignedUserId, meetingId);

      if (!result.changes) {
        return null;
      }

      return (
        database
          .prepare<unknown[], DbMeetingWithAssignmentRow>(
            `${selectActiveMeetingsQuery} WHERE meetings.id = ? LIMIT 1`,
          )
          .get(meetingId) ?? null
      );
    },

    async resolveMeeting(meetingId, resolvedAt) {
      const database = getDb();
      const row = database
        .prepare<unknown[], DbMeetingRow>(
          "SELECT * FROM meetings WHERE id = ? LIMIT 1",
        )
        .get(meetingId);

      if (!row) {
        return false;
      }

      database
        .prepare("DELETE FROM past_meetings WHERE google_event_id = ?")
        .run(row.google_event_id);
      database.prepare(`
        INSERT INTO past_meetings (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
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
      );

      database.prepare("DELETE FROM meetings WHERE id = ?").run(meetingId);
      return true;
    },

    async replaceMeetings(meetings) {
      const database = getDb();
      const transaction = database.transaction(
        (incomingMeetings: CalendarMeeting[]): ReplaceMeetingsResult => {
          const resolvedGoogleEventIds = new Set(
            database
              .prepare<[], { google_event_id: string }>(
                "SELECT google_event_id FROM past_meetings",
              )
              .all()
              .map((row) => row.google_event_id),
          );
          const activeMeetings = incomingMeetings.filter(
            (meeting) => !resolvedGoogleEventIds.has(meeting.googleEventId),
          );
          const previousAssignments = database
            .prepare<[], { google_event_id: string; assigned_user_id: string | null }>(
              "SELECT google_event_id, assigned_user_id FROM meetings",
            )
            .all()
            .reduce<Record<string, string | null>>((accumulator, row) => {
              accumulator[row.google_event_id] = row.assigned_user_id;
              return accumulator;
            }, {});

          const previousCount =
            database
              .prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM meetings")
              .get() ?? { count: 0 };
          database.prepare("DELETE FROM meetings").run();

          const insert = database.prepare(`
            INSERT INTO meetings (
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          const syncedAt = new Date().toISOString();

          for (const meeting of activeMeetings) {
            insert.run(
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
            );
          }

          database.prepare(`
            INSERT INTO sync_state (key, value) VALUES ('lastSuccessfulSyncAt', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
          `).run(syncedAt);

          return {
            imported: activeMeetings.length,
            updated: Math.min(previousCount.count, activeMeetings.length),
            removed: Math.max(previousCount.count - activeMeetings.length, 0),
            syncedAt,
          };
        },
      );

      return transaction(meetings);
    },

    async findMeetingByIdIncludingPast(meetingId) {
      const database = getDb();
      const activeMeeting =
        database
          .prepare<unknown[], DbMeetingWithAssignmentRow>(
            `${selectActiveMeetingsQuery} WHERE meetings.id = ? LIMIT 1`,
          )
          .get(meetingId) ?? null;

      if (activeMeeting) {
        return activeMeeting;
      }

      return (
        database
          .prepare<unknown[], DbPastMeetingWithAssignmentRow>(
            `${selectPastMeetingsQuery} WHERE past_meetings.id = ? LIMIT 1`,
          )
          .get(meetingId) ?? null
      );
    },

    async getAiMeetingGuideByGoogleEventId(googleEventId) {
      const database = getDb();
      return (
        database
          .prepare<unknown[], DbAiMeetingGuideRow>(
            "SELECT * FROM ai_meeting_guides WHERE google_event_id = ? LIMIT 1",
          )
          .get(googleEventId) ?? null
      );
    },

    async upsertAiMeetingGuide(row) {
      const database = getDb();
      database.prepare(`
        INSERT INTO ai_meeting_guides (
          google_event_id,
          guide_json,
          created_by_user_id,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(google_event_id) DO UPDATE SET
          guide_json = excluded.guide_json,
          created_by_user_id = excluded.created_by_user_id,
          updated_at = excluded.updated_at
      `).run(
        row.google_event_id,
        row.guide_json,
        row.created_by_user_id,
        row.created_at,
        row.updated_at,
      );
    },

    async deleteAiMeetingGuideByGoogleEventId(googleEventId) {
      const database = getDb();
      database
        .prepare("DELETE FROM ai_meeting_guides WHERE google_event_id = ?")
        .run(googleEventId);
    },

    async insertAiPostImageGeneration(row) {
      const database = getDb();
      database.prepare(`
        INSERT INTO ai_post_image_generations (
          id,
          conversation_id,
          prompt,
          caption,
          tags_json,
          image_name,
          image_model,
          created_by_user_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.id,
        row.conversation_id,
        row.prompt,
        row.caption,
        row.tags_json,
        row.image_name,
        row.image_model,
        row.created_by_user_id,
        row.created_at,
      );
    },

    async listRecentAiPostImageGenerations(conversationId, userId, limit) {
      const database = getDb();
      return database
        .prepare<unknown[], DbAiPostImageGenerationRow>(`
          SELECT *
          FROM ai_post_image_generations
          WHERE conversation_id = ?
            AND created_by_user_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `)
        .all(conversationId, userId, limit);
    },

    async insertAiPostCaptionGeneration(row) {
      const database = getDb();
      database
        .prepare(`
          INSERT INTO ai_post_caption_generations (
            id, conversation_id, prompt, platform, caption, hashtags_json,
            model, created_by_user_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          row.id,
          row.conversation_id,
          row.prompt,
          row.platform,
          row.caption,
          row.hashtags_json,
          row.model,
          row.created_by_user_id,
          row.created_at,
        );
    },

    async listRecentAiPostCaptionGenerations(userId, limit) {
      const database = getDb();
      return database
        .prepare<unknown[], DbAiPostCaptionGenerationRow>(`
          SELECT *
          FROM ai_post_caption_generations
          WHERE created_by_user_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `)
        .all(userId, limit);
    },

    async listPublishedSocialPosts(limit) {
      const database = getDb();
      return database
        .prepare<unknown[], DbScheduledSocialPostWithCreatorRow>(
          `${selectScheduledSocialPostsQuery}
           WHERE scheduled_social_posts.status = 'published'
           ORDER BY scheduled_social_posts.published_at DESC
           LIMIT ?`,
        )
        .all(limit);
    },

    async listPostsForAccounts(accountIds, statuses, perAccountLimit) {
      if (!accountIds.length || !statuses.length) {
        return [];
      }

      const database = getDb();
      const accountPlaceholders = accountIds.map(() => "?").join(", ");
      const statusPlaceholders = statuses.map(() => "?").join(", ");

      // Window function caps rows PER account so per-account history is bounded.
      return database
        .prepare<unknown[], DbScheduledSocialPostWithCreatorRow>(
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
             FROM scheduled_social_posts
             LEFT JOIN users ON users.id = scheduled_social_posts.created_by_user_id
             WHERE scheduled_social_posts.account_id IN (${accountPlaceholders})
               AND scheduled_social_posts.status IN (${statusPlaceholders})
           )
           WHERE rn <= ?
           ORDER BY account_id,
             COALESCE(published_at, created_at) DESC, id DESC`,
        )
        .all(...accountIds, ...statuses, perAccountLimit);
    },

    async insertMeetingRequest(row) {
      const database = getDb();
      database.prepare(`
        INSERT INTO meeting_requests (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
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
      );
    },

    async findMeetingRequestById(id) {
      const database = getDb();
      return (
        database
          .prepare<unknown[], DbMeetingRequestRow>(
            "SELECT * FROM meeting_requests WHERE id = ? LIMIT 1",
          )
          .get(id) ?? null
      );
    },

    async deleteMeetingRequestById(id) {
      const database = getDb();
      database.prepare("DELETE FROM meeting_requests WHERE id = ?").run(id);
    },

    async insertLoftBooking(row) {
      const database = getDb();
      database.prepare(`
        INSERT INTO loft_bookings (
          id,
          name,
          business,
          email,
          phone,
          message,
          submitted_at,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.id,
        row.name,
        row.business,
        row.email,
        row.phone,
        row.message,
        row.submitted_at,
        row.created_at,
      );
    },

    async listLoftBookings() {
      const database = getDb();
      return database
        .prepare<unknown[], DbLoftBookingRow>(
          "SELECT * FROM loft_bookings ORDER BY submitted_at DESC",
        )
        .all();
    },

    async hasLoftAccess(userId) {
      const database = getDb();
      const row = database
        .prepare<unknown[], { user_id: string }>(
          "SELECT user_id FROM loft_access WHERE user_id = ? LIMIT 1",
        )
        .get(userId);

      return Boolean(row);
    },

    async grantLoftAccess(userId) {
      const database = getDb();
      database
        .prepare(
          `INSERT INTO loft_access (user_id, granted_at)
           VALUES (?, ?)
           ON CONFLICT (user_id) DO NOTHING`,
        )
        .run(userId, new Date().toISOString());
    },

    async listCallingProspects() {
      const database = getDb();
      return database
        .prepare<unknown[], DbCallingProspectRow>(
          "SELECT * FROM calling_prospects ORDER BY updated_at DESC, name ASC",
        )
        .all();
    },

    async findCallingProspectById(id) {
      const database = getDb();
      return (
        database
          .prepare<unknown[], DbCallingProspectRow>(
            "SELECT * FROM calling_prospects WHERE id = ? LIMIT 1",
          )
          .get(id) ?? null
      );
    },

    async insertCallingProspect(row) {
      const database = getDb();
      database.prepare(`
        INSERT INTO calling_prospects (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
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
      );
    },

    async upsertCallingProspects(rows) {
      const database = getDb();
      const transaction = database.transaction(
        (incomingRows: DbCallingProspectRow[]): UpsertCallingProspectsResult => {
          const syncedAt = new Date().toISOString();

          if (!incomingRows.length) {
            database.prepare(`
              INSERT INTO sync_state (key, value) VALUES ('lastCallingSheetSyncAt', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value
            `).run(syncedAt);

            return { imported: 0, updated: 0, skipped: 0, syncedAt };
          }

          const externalIds = incomingRows
            .map((row) => row.external_id)
            .filter((externalId): externalId is string => Boolean(externalId));
          const placeholders = externalIds.map(() => "?").join(", ");
          const existing = placeholders
            ? new Set(
                database
                  .prepare<unknown[], { external_id: string }>(
                    `SELECT external_id FROM calling_prospects WHERE external_id IN (${placeholders})`,
                  )
                  .all(...externalIds)
                  .map((row) => row.external_id),
              )
            : new Set<string>();

          const insert = database.prepare(`
            INSERT INTO calling_prospects (
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          const update = database.prepare(`
            UPDATE calling_prospects
            SET
              name = ?,
              phone = ?,
              company_name = ?,
              email = ?,
              notes = ?,
              source = ?,
              updated_at = ?
            WHERE external_id = ?
          `);

          let imported = 0;
          let updated = 0;

          for (const row of incomingRows) {
            if (row.external_id && existing.has(row.external_id)) {
              update.run(
                row.name,
                row.phone,
                row.company_name,
                row.email,
                row.notes,
                row.source,
                syncedAt,
                row.external_id,
              );
              updated += 1;
              continue;
            }

            insert.run(
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
            );
            if (row.external_id) {
              existing.add(row.external_id);
            }
            imported += 1;
          }

          database.prepare(`
            INSERT INTO sync_state (key, value) VALUES ('lastCallingSheetSyncAt', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
          `).run(syncedAt);

          return { imported, updated, skipped: 0, syncedAt };
        },
      );

      return transaction(rows);
    },

    async updateCallingProspectStatus(prospectId, patch) {
      const database = getDb();
      const updatedAt = new Date().toISOString();
      const result = database.prepare(`
        UPDATE calling_prospects
        SET
          status = ?,
          last_call_at = COALESCE(?, last_call_at),
          last_call_outcome = COALESCE(?, last_call_outcome),
          updated_at = ?
        WHERE id = ?
      `).run(
        patch.status,
        patch.lastCallAt ?? null,
        patch.lastCallOutcome ?? null,
        updatedAt,
        prospectId,
      );

      if (!result.changes) {
        return null;
      }

      return (
        database
          .prepare<unknown[], DbCallingProspectRow>(
            "SELECT * FROM calling_prospects WHERE id = ? LIMIT 1",
          )
          .get(prospectId) ?? null
      );
    },

    async listCallingBatches(limit) {
      const database = getDb();
      return database
        .prepare<unknown[], DbCallingBatchRow>(
          "SELECT * FROM calling_batches ORDER BY created_at DESC LIMIT ?",
        )
        .all(limit);
    },

    async findCallingBatchById(id) {
      const database = getDb();
      return (
        database
          .prepare<unknown[], DbCallingBatchRow>(
            "SELECT * FROM calling_batches WHERE id = ? LIMIT 1",
          )
          .get(id) ?? null
      );
    },

    async insertCallingBatch(batch, calls) {
      const database = getDb();
      const transaction = database.transaction(
        (incomingBatch: DbCallingBatchRow, incomingCalls: DbCallingCallRow[]) => {
          database.prepare(`
            INSERT INTO calling_batches (
              id,
              status,
              total_count,
              created_by_user_id,
              created_at,
              started_at,
              completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            incomingBatch.id,
            incomingBatch.status,
            incomingBatch.total_count,
            incomingBatch.created_by_user_id,
            incomingBatch.created_at,
            incomingBatch.started_at,
            incomingBatch.completed_at,
          );

          const insertCall = database.prepare(`
            INSERT INTO calling_calls (
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          const markQueued = database.prepare(`
            UPDATE calling_prospects
            SET status = 'queued', updated_at = ?
            WHERE id = ? AND status != 'do_not_call'
          `);

          for (const call of incomingCalls) {
            insertCall.run(
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
            );
            markQueued.run(incomingBatch.created_at, call.prospect_id);
          }
        },
      );

      transaction(batch, calls);
    },

    async updateCallingBatchStatus(batchId, patch) {
      const database = getDb();
      const result = database.prepare(`
        UPDATE calling_batches
        SET
          status = ?,
          started_at = COALESCE(started_at, ?),
          completed_at = COALESCE(?, completed_at)
        WHERE id = ?
      `).run(
        patch.status,
        patch.startedAt ?? null,
        patch.completedAt ?? null,
        batchId,
      );

      if (!result.changes) {
        return null;
      }

      return (
        database
          .prepare<unknown[], DbCallingBatchRow>(
            "SELECT * FROM calling_batches WHERE id = ? LIMIT 1",
          )
          .get(batchId) ?? null
      );
    },

    async listCallingCalls(limit) {
      const database = getDb();
      return database
        .prepare<unknown[], DbCallingCallRow>(
          "SELECT * FROM calling_calls ORDER BY created_at DESC, sequence_index ASC LIMIT ?",
        )
        .all(limit);
    },

    async listCallingCallsByBatch(batchId) {
      const database = getDb();
      return database
        .prepare<unknown[], DbCallingCallRow>(
          "SELECT * FROM calling_calls WHERE batch_id = ? ORDER BY sequence_index ASC",
        )
        .all(batchId);
    },

    async findCallingCallById(id) {
      const database = getDb();
      return (
        database
          .prepare<unknown[], DbCallingCallRow>(
            "SELECT * FROM calling_calls WHERE id = ? LIMIT 1",
          )
          .get(id) ?? null
      );
    },

    async findNextQueuedCallingCall(batchId) {
      const database = getDb();
      return (
        database
          .prepare<unknown[], DbCallingCallRow>(
            `SELECT * FROM calling_calls
             WHERE batch_id = ? AND status = 'queued'
             ORDER BY sequence_index ASC
             LIMIT 1`,
          )
          .get(batchId) ?? null
      );
    },

    async updateCallingCallStatus(callId, patch) {
      const database = getDb();
      const updatedAt = new Date().toISOString();
      const result = database.prepare(`
        UPDATE calling_calls
        SET
          status = ?,
          outcome = COALESCE(?, outcome),
          notes = COALESCE(?, notes),
          duration_seconds = COALESCE(?, duration_seconds),
          external_call_id = COALESCE(?, external_call_id),
          status_message = ?,
          started_at = COALESCE(started_at, ?),
          completed_at = COALESCE(?, completed_at),
          updated_at = ?
        WHERE id = ?
      `).run(
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
      );

      if (!result.changes) {
        return null;
      }

      return (
        database
          .prepare<unknown[], DbCallingCallRow>(
            "SELECT * FROM calling_calls WHERE id = ? LIMIT 1",
          )
          .get(callId) ?? null
      );
    },

    async listCallingSheetSources() {
      const database = getDb();
      return database
        .prepare<unknown[], DbCallingSheetSourceRow>(
          "SELECT * FROM calling_sheet_sources ORDER BY created_at DESC, label ASC",
        )
        .all();
    },

    async insertCallingSheetSource(row) {
      const database = getDb();
      database
        .prepare(
          `
            INSERT INTO calling_sheet_sources (
              id,
              spreadsheet_id,
              label,
              created_by_user_id,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          row.id,
          row.spreadsheet_id,
          row.label,
          row.created_by_user_id,
          row.created_at,
          row.updated_at,
        );
    },

    async deleteCallingSheetSource(id) {
      const database = getDb();
      const result = database
        .prepare("DELETE FROM calling_sheet_sources WHERE id = ?")
        .run(id);

      return result.changes > 0;
    },

    async getLastCallingSheetSyncAt() {
      const database = getDb();
      return (
        (
          database
            .prepare<[], { value?: string }>(
              "SELECT value FROM sync_state WHERE key = 'lastCallingSheetSyncAt' LIMIT 1",
            )
            .get() as { value?: string } | undefined
        )?.value ?? null
      );
    },

    async insertScheduledSocialPosts(rows) {
      const database = getDb();
      const insert = database.prepare(`
        INSERT INTO scheduled_social_posts (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const transaction = database.transaction((items: DbScheduledSocialPostRow[]) => {
        for (const row of items) {
          insert.run(
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
          );
        }
      });

      transaction(rows);
    },

    async listScheduledSocialPosts() {
      const database = getDb();
      return database
        .prepare<unknown[], DbScheduledSocialPostWithCreatorRow>(
          `${selectScheduledSocialPostsQuery} ORDER BY scheduled_social_posts.scheduled_for ASC, scheduled_social_posts.created_at ASC`,
        )
        .all();
    },

    async findScheduledSocialPostById(id) {
      const database = getDb();
      return (
        database
          .prepare<unknown[], DbScheduledSocialPostWithCreatorRow>(
            `${selectScheduledSocialPostsQuery} WHERE scheduled_social_posts.id = ? LIMIT 1`,
          )
          .get(id) ?? null
      );
    },

    async listDueScheduledSocialPosts(nowIso, limit) {
      const database = getDb();
      return database
        .prepare<unknown[], DbScheduledSocialPostWithCreatorRow>(
          `${selectScheduledSocialPostsQuery}
           WHERE scheduled_social_posts.status = 'scheduled'
             AND scheduled_social_posts.scheduled_for <= ?
           ORDER BY scheduled_social_posts.scheduled_for ASC
           LIMIT ?`,
        )
        .all(nowIso, limit);
    },

    async rescheduleScheduledSocialPost(id, scheduledFor, timezone) {
      const database = getDb();
      database.prepare(`
        UPDATE scheduled_social_posts
        SET
          scheduled_for = ?,
          timezone = ?,
          status = 'scheduled',
          status_message = 'Waiting for scheduled publish time.',
          published_at = NULL,
          updated_at = ?
        WHERE id = ?
          AND status IN ('scheduled', 'failed', 'connection_required')
      `).run(scheduledFor, timezone, new Date().toISOString(), id);

      return (
        database
          .prepare<unknown[], DbScheduledSocialPostWithCreatorRow>(
            `${selectScheduledSocialPostsQuery} WHERE scheduled_social_posts.id = ? LIMIT 1`,
          )
          .get(id) ?? null
      );
    },

    async deleteScheduledSocialPost(id) {
      const database = getDb();
      const result = database.prepare(`
        DELETE FROM scheduled_social_posts
        WHERE id = ?
          AND status IN ('scheduled', 'failed', 'connection_required', 'cancelled', 'pending_review')
      `).run(id);

      return result.changes > 0;
    },

    async updateScheduledSocialPostCaption(id, caption) {
      const database = getDb();
      const result = database.prepare(`
        UPDATE scheduled_social_posts
        SET caption = ?, updated_at = ?
        WHERE id = ?
          AND status IN ('scheduled', 'failed', 'connection_required', 'pending_review')
      `).run(caption, new Date().toISOString(), id);

      // Status guard rejected the edit (or no such post): report no row so the
      // caller returns a clear 404 instead of a misleading success.
      if (!result.changes) {
        return null;
      }

      return (
        database
          .prepare<unknown[], DbScheduledSocialPostWithCreatorRow>(
            `${selectScheduledSocialPostsQuery} WHERE scheduled_social_posts.id = ? LIMIT 1`,
          )
          .get(id) ?? null
      );
    },

    async approvePendingSocialPost(id, scheduledFor, timezone) {
      const database = getDb();
      database.prepare(`
        UPDATE scheduled_social_posts
        SET
          scheduled_for = ?,
          timezone = ?,
          status = 'scheduled',
          status_message = 'Approved — waiting for scheduled publish time.',
          published_at = NULL,
          updated_at = ?
        WHERE id = ?
          AND status = 'pending_review'
      `).run(scheduledFor, timezone, new Date().toISOString(), id);

      return (
        database
          .prepare<unknown[], DbScheduledSocialPostWithCreatorRow>(
            `${selectScheduledSocialPostsQuery} WHERE scheduled_social_posts.id = ? LIMIT 1`,
          )
          .get(id) ?? null
      );
    },

    async updateScheduledSocialPostStatus(id, status, patch = {}) {
      const database = getDb();
      database.prepare(`
        UPDATE scheduled_social_posts
        SET
          status = ?,
          status_message = ?,
          external_post_id = COALESCE(?, external_post_id),
          published_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        status,
        patch.statusMessage ?? null,
        patch.externalPostId ?? null,
        patch.publishedAt ?? null,
        new Date().toISOString(),
        id,
      );

      return (
        database
          .prepare<unknown[], DbScheduledSocialPostWithCreatorRow>(
            `${selectScheduledSocialPostsQuery} WHERE scheduled_social_posts.id = ? LIMIT 1`,
          )
          .get(id) ?? null
      );
    },

    async upsertSocialAccount(row) {
      const database = getDb();
      database.prepare(`
        INSERT INTO social_accounts (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          platform = excluded.platform,
          display_name = excluded.display_name,
          account_id = excluded.account_id,
          access_token = excluded.access_token,
          token_type = excluded.token_type,
          expires_at = excluded.expires_at,
          scopes = excluded.scopes,
          metadata_json = excluded.metadata_json,
          active = excluded.active,
          created_by_user_id = excluded.created_by_user_id,
          updated_at = excluded.updated_at
      `).run(
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
      );
    },

    async listSocialAccounts() {
      const database = getDb();
      return database
        .prepare<unknown[], DbSocialAccountWithCreatorRow>(
          `${selectSocialAccountsQuery}
           WHERE social_accounts.active = 1
           ORDER BY social_accounts.platform ASC`,
        )
        .all();
    },

    async findSocialAccountByPlatform(platform) {
      const database = getDb();
      return (
        database
          .prepare<unknown[], DbSocialAccountWithCreatorRow>(
            `${selectSocialAccountsQuery}
             WHERE social_accounts.platform = ?
               AND social_accounts.active = 1
             LIMIT 1`,
          )
          .get(platform) ?? null
      );
    },

    async findSocialAccountById(id) {
      const database = getDb();
      return (
        database
          .prepare<unknown[], DbSocialAccountWithCreatorRow>(
            `${selectSocialAccountsQuery}
             WHERE social_accounts.id = ?
               AND social_accounts.active = 1
             LIMIT 1`,
          )
          .get(id) ?? null
      );
    },

    async updateSocialAccountTokens(id, patch) {
      const database = getDb();
      database
        .prepare(
          `UPDATE social_accounts
           SET access_token = ?, expires_at = ?, metadata_json = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          patch.accessToken,
          patch.expiresAt,
          patch.metadataJson,
          new Date().toISOString(),
          id,
        );
    },

    async deleteSocialAccount(id) {
      const database = getDb();
      const result = database.prepare("DELETE FROM social_accounts WHERE id = ?").run(id);
      return result.changes > 0;
    },

    async getAutoPostAgentConfig() {
      const database = getDb();
      return (
        database
          .prepare<unknown[], DbAutoPostAgentConfigRow>(
            "SELECT * FROM auto_post_agent_config WHERE id = 'default' LIMIT 1",
          )
          .get() ?? null
      );
    },

    async upsertAutoPostAgentConfig(row) {
      const database = getDb();
      database
        .prepare(`
          INSERT INTO auto_post_agent_config (
            id, enabled, cadence_json, posts_per_run, target_account_ids_json,
            image_style, timezone, last_run_at, slot_runs_json,
            updated_by_user_id, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            enabled = excluded.enabled,
            cadence_json = excluded.cadence_json,
            posts_per_run = excluded.posts_per_run,
            target_account_ids_json = excluded.target_account_ids_json,
            image_style = excluded.image_style,
            timezone = excluded.timezone,
            last_run_at = excluded.last_run_at,
            slot_runs_json = excluded.slot_runs_json,
            updated_by_user_id = excluded.updated_by_user_id,
            updated_at = excluded.updated_at
        `)
        .run(
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
        );
    },

    async claimAutoPostAgentSlot(slotId, expectedLastFiredAt, nowIso) {
      const database = getDb();
      // Read-modify-write the slot_runs_json blob inside a transaction so the
      // compare-and-swap is atomic against concurrent slot claims in one tick.
      const claim = database.transaction((): boolean => {
        const current = database
          .prepare<unknown[], { slot_runs_json: string }>(
            "SELECT slot_runs_json FROM auto_post_agent_config WHERE id = 'default'",
          )
          .get();

        if (!current) {
          return false;
        }

        let runs: Record<string, string | null> = {};
        try {
          const parsed = JSON.parse(current.slot_runs_json || "{}") as unknown;
          if (parsed && typeof parsed === "object") {
            runs = parsed as Record<string, string | null>;
          }
        } catch {
          runs = {};
        }

        const stored = runs[slotId] ?? null;
        if (stored !== expectedLastFiredAt) {
          return false;
        }

        runs[slotId] = nowIso;
        const result = database
          .prepare(
            `UPDATE auto_post_agent_config
             SET slot_runs_json = ?, last_run_at = ?
             WHERE id = 'default' AND slot_runs_json = ?`,
          )
          .run(JSON.stringify(runs), nowIso, current.slot_runs_json);

        return result.changes > 0;
      });

      return claim();
    },
  };
};

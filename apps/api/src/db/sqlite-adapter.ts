import fs from "node:fs";
import path from "node:path";
import argon2 from "argon2";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import type {
  CalendarMeeting,
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
  };
};

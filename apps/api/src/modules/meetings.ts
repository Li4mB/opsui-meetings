import {
  assignmentInputSchema,
  meetingFiltersSchema,
  meetingsResponseSchema,
  meetingSchema,
  syncResponseSchema,
} from "@opsui/shared";
import { nanoid } from "nanoid";
import { db } from "../db/database.js";
import { authenticateRequest, requireAdmin } from "./auth.js";
import { fetchCalendarMeetings } from "./google-calendar.js";
import type { CalendarMeeting, DbMeetingRow, DbPastMeetingRow } from "../types.js";

const toMeeting = (row: DbMeetingRow & { assigned_user_name?: string | null; assigned_user_color?: string | null }) =>
  meetingSchema.parse({
    id: row.id,
    googleEventId: row.google_event_id,
    title: row.title,
    clientName: row.client_name,
    company: row.company,
    country: row.country,
    meetingType: row.meeting_type,
    startAtUtc: row.start_at_utc,
    endAtUtc: row.end_at_utc,
    sourceTimezone: row.source_timezone,
    googleMeetUrl: row.google_meet_url,
    googleDocUrl: row.google_doc_url,
    clientEmail: row.client_email,
    phone: row.phone,
    companySize: row.company_size,
    modulesOfInterest: JSON.parse(row.modules_of_interest_json) as string[],
    descriptionRaw: row.description_raw,
    calendarHtmlUrl: row.calendar_html_url,
    assignedUserId: row.assigned_user_id,
    assignedUserName: row.assigned_user_name ?? null,
    assignedUserColor: row.assigned_user_color ?? null,
    updatedAt: row.updated_at,
    lastSyncedAt: row.last_synced_at,
  });

const selectMeetingsQuery = `
  SELECT
    meetings.*,
    users.display_name AS assigned_user_name,
    users.color_hex AS assigned_user_color
  FROM meetings
  LEFT JOIN users ON users.id = meetings.assigned_user_id
`;

const replaceMeetings = db.transaction((meetings: CalendarMeeting[]) => {
  const resolvedGoogleEventIds = new Set(
    db
      .prepare<[], { google_event_id: string }>(
        "SELECT google_event_id FROM past_meetings",
      )
      .all()
      .map((row) => row.google_event_id),
  );
  const activeMeetings = meetings.filter(
    (meeting) => !resolvedGoogleEventIds.has(meeting.googleEventId),
  );
  const previousAssignments = db
    .prepare<[], { google_event_id: string; assigned_user_id: string | null }>(
      "SELECT google_event_id, assigned_user_id FROM meetings",
    )
    .all()
    .reduce<Record<string, string | null>>((accumulator, row) => {
      accumulator[row.google_event_id] = row.assigned_user_id;
      return accumulator;
    }, {});

  const previousCount =
    db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM meetings").get() ??
    { count: 0 };
  db.prepare("DELETE FROM meetings").run();

  const insert = db.prepare(`
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

  db.prepare(`
    INSERT INTO sync_state (key, value) VALUES ('lastSuccessfulSyncAt', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(syncedAt);

  return {
    imported: activeMeetings.length,
    updated: Math.min(previousCount.count, activeMeetings.length),
    removed: Math.max(previousCount.count - activeMeetings.length, 0),
    syncedAt,
  };
});

export const registerMeetingRoutes = (app: import("fastify").FastifyInstance) => {
  app.get(
    "/meetings",
    { preHandler: [authenticateRequest] },
    async (request) => {
      const filters = meetingFiltersSchema.parse(request.query);
      const clauses: string[] = [];
      const params: string[] = [];

      if (filters.country) {
        clauses.push("meetings.country = ?");
        params.push(filters.country);
      }

      if (filters.assignedUserId) {
        clauses.push("meetings.assigned_user_id = ?");
        params.push(filters.assignedUserId);
      }

      if (filters.from) {
        clauses.push("meetings.start_at_utc >= ?");
        params.push(filters.from);
      }

      if (filters.to) {
        clauses.push("meetings.start_at_utc <= ?");
        params.push(filters.to);
      }

      const whereClause = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
      const rows = db
        .prepare<unknown[], DbMeetingRow & { assigned_user_name: string | null; assigned_user_color: string | null }>(
          `${selectMeetingsQuery}${whereClause} ORDER BY meetings.start_at_utc ASC`,
        )
        .all(...params);

      const lastSuccessfulSyncAt = (db
        .prepare<[], { value?: string }>(
          "SELECT value FROM sync_state WHERE key = 'lastSuccessfulSyncAt' LIMIT 1",
        )
        .get() as { value?: string } | undefined)?.value ?? null;

      return meetingsResponseSchema.parse({
        meetings: rows.map(toMeeting),
        lastSuccessfulSyncAt,
        cached: false,
      });
    },
  );

  app.get(
    "/meetings/past",
    { preHandler: [authenticateRequest] },
    async (request) => {
      const filters = meetingFiltersSchema.parse(request.query);
      const clauses: string[] = [];
      const params: string[] = [];

      if (filters.country) {
        clauses.push("past_meetings.country = ?");
        params.push(filters.country);
      }

      if (filters.assignedUserId) {
        clauses.push("past_meetings.assigned_user_id = ?");
        params.push(filters.assignedUserId);
      }

      if (filters.from) {
        clauses.push("past_meetings.start_at_utc >= ?");
        params.push(filters.from);
      }

      if (filters.to) {
        clauses.push("past_meetings.start_at_utc <= ?");
        params.push(filters.to);
      }

      const whereClause = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
      const rows = db
        .prepare<unknown[], DbPastMeetingRow & { assigned_user_name: string | null; assigned_user_color: string | null }>(
          `
            SELECT
              past_meetings.*,
              users.display_name AS assigned_user_name,
              users.color_hex AS assigned_user_color
            FROM past_meetings
            LEFT JOIN users ON users.id = past_meetings.assigned_user_id
            ${whereClause}
            ORDER BY past_meetings.start_at_utc DESC
          `,
        )
        .all(...params);

      return meetingsResponseSchema.parse({
        meetings: rows.map(toMeeting),
        lastSuccessfulSyncAt: null,
        cached: false,
      });
    },
  );

  const updateAssignment = async (
    request: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply,
  ) => {
    const id = (request.params as { id: string }).id;
    const input = assignmentInputSchema.parse(request.body);
    const result = db
      .prepare("UPDATE meetings SET assigned_user_id = ? WHERE id = ?")
      .run(input.assignedUserId, id);

    if (!result.changes) {
      return reply.notFound("Meeting not found");
    }

    const row = db
      .prepare<unknown[], DbMeetingRow & { assigned_user_name: string | null; assigned_user_color: string | null }>(
        `${selectMeetingsQuery} WHERE meetings.id = ? LIMIT 1`,
      )
      .get(id);

    if (!row) {
      return reply.notFound("Meeting not found");
    }

    return toMeeting(row);
  };

  app.patch(
    "/meetings/:id/assignment",
    { preHandler: [authenticateRequest] },
    updateAssignment,
  );

  app.post(
    "/meetings/:id/assignment",
    { preHandler: [authenticateRequest] },
    updateAssignment,
  );

  app.post(
    "/meetings/:id/resolve",
    { preHandler: [authenticateRequest, requireAdmin] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const row = db
        .prepare<unknown[], DbMeetingRow>(
          "SELECT * FROM meetings WHERE id = ? LIMIT 1",
        )
        .get(id);

      if (!row) {
        return reply.notFound("Meeting not found");
      }

      const resolvedAt = new Date().toISOString();

      db.prepare("DELETE FROM past_meetings WHERE google_event_id = ?").run(row.google_event_id);
      db.prepare(`
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

      db.prepare("DELETE FROM meetings WHERE id = ?").run(id);

      return reply.status(204).send();
    },
  );

  app.post(
    "/meetings/sync",
    { preHandler: [authenticateRequest] },
    async () => {
      const meetings = await fetchCalendarMeetings();
      return syncResponseSchema.parse(replaceMeetings(meetings));
    },
  );
};

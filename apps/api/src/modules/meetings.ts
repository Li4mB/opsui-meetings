import {
  assignmentInputSchema,
  meetingFiltersSchema,
  meetingsResponseSchema,
  meetingSchema,
  syncResponseSchema,
} from "@opsui/shared";
import { storage } from "../db/database.js";
import { authenticateRequest, requireAdmin } from "./auth.js";
import { fetchCalendarMeetings } from "./google-calendar.js";
import type {
  DbMeetingWithAssignmentRow,
  DbPastMeetingWithAssignmentRow,
} from "../db/adapter.js";

const toMeeting = (
  row:
    | DbMeetingWithAssignmentRow
    | DbPastMeetingWithAssignmentRow,
) =>
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

export const registerMeetingRoutes = (app: import("fastify").FastifyInstance) => {
  app.get(
    "/meetings",
    { preHandler: [authenticateRequest] },
    async (request) => {
      const filters = meetingFiltersSchema.parse(request.query);
      const rows = await storage.listMeetings(filters);
      const lastSuccessfulSyncAt = await storage.getLastSuccessfulSyncAt();

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
      const rows = await storage.listPastMeetings(filters);

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
    const row = await storage.updateMeetingAssignment(id, input.assignedUserId);

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
      const resolved = await storage.resolveMeeting(id, new Date().toISOString());

      if (!resolved) {
        return reply.notFound("Meeting not found");
      }

      return reply.status(204).send();
    },
  );

  app.post(
    "/meetings/sync",
    { preHandler: [authenticateRequest] },
    async () => {
      const meetings = await fetchCalendarMeetings();
      return syncResponseSchema.parse(await storage.replaceMeetings(meetings));
    },
  );
};

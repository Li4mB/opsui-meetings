import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import {
  aiMeetingGuideContentSchema,
  aiMeetingGuideBindingSchema,
  aiMeetingGuideRequestSchema,
  aiMeetingGuideSchema,
  meetingSchema,
} from "@opsui/shared";
import { db } from "../db/database.js";
import { env } from "../config/env.js";
import { authenticateRequest } from "./auth.js";
import type {
  DbAiMeetingGuideRow,
  DbMeetingRow,
  DbPastMeetingRow,
} from "../types.js";

const toMeeting = (
  row:
    | (DbMeetingRow & {
        assigned_user_name?: string | null;
        assigned_user_color?: string | null;
      })
    | (DbPastMeetingRow & {
        assigned_user_name?: string | null;
        assigned_user_color?: string | null;
      }),
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

const openai = env.openAiApiKey
  ? new OpenAI({
      apiKey: env.openAiApiKey,
    })
  : null;

const formatMeetingContext = (meeting: ReturnType<typeof toMeeting>) =>
  [
    `Title: ${meeting.title}`,
    `Client Name: ${meeting.clientName}`,
    `Company: ${meeting.company}`,
    `Country: ${meeting.country}`,
    `Meeting Type: ${meeting.meetingType}`,
    `Client Email: ${meeting.clientEmail ?? "Unknown"}`,
    `Phone: ${meeting.phone ?? "Unknown"}`,
    `Company Size: ${meeting.companySize ?? "Unknown"}`,
    `Assigned Owner: ${meeting.assignedUserName ?? "Unassigned"}`,
    `Modules of Interest: ${
      meeting.modulesOfInterest.length
        ? meeting.modulesOfInterest.join(", ")
        : "None listed"
    }`,
    `Google Doc Available: ${meeting.googleDocUrl ? "Yes" : "No"}`,
    `Raw Brief Text:\n${meeting.descriptionRaw || "No brief text provided."}`,
  ].join("\n");

const buildGuidePrompt = (meeting: ReturnType<typeof toMeeting>) =>
  [
    "Create an internal OpsUI demo meeting guide for the rep about to run this meeting.",
    "Use only the meeting context provided and any retrieved OpsUI knowledge base context.",
    "Do not invent product capabilities, integrations, or pricing.",
    "If something is unknown, say it is unknown instead of guessing.",
    "Focus on a practical talk track for a live demo call.",
    "",
    "Meeting context:",
    formatMeetingContext(meeting),
  ].join("\n");

const getMeetingById = (meetingId: string) => {
  const activeRow = db
    .prepare<
      unknown[],
      DbMeetingRow & {
        assigned_user_name: string | null;
        assigned_user_color: string | null;
      }
    >(
      `
        SELECT
          meetings.*,
          users.display_name AS assigned_user_name,
          users.color_hex AS assigned_user_color
        FROM meetings
        LEFT JOIN users ON users.id = meetings.assigned_user_id
        WHERE meetings.id = ?
        LIMIT 1
      `,
    )
    .get(meetingId);

  if (activeRow) {
    return toMeeting(activeRow);
  }

  const pastRow = db
    .prepare<
      unknown[],
      DbPastMeetingRow & {
        assigned_user_name: string | null;
        assigned_user_color: string | null;
      }
    >(
      `
        SELECT
          past_meetings.*,
          users.display_name AS assigned_user_name,
          users.color_hex AS assigned_user_color
        FROM past_meetings
        LEFT JOIN users ON users.id = past_meetings.assigned_user_id
        WHERE past_meetings.id = ?
        LIMIT 1
      `,
    )
    .get(meetingId);

  return pastRow ? toMeeting(pastRow) : null;
};

const getBoundGuideByGoogleEventId = (googleEventId: string) => {
  const row = db
    .prepare<unknown[], DbAiMeetingGuideRow>(
      `
        SELECT *
        FROM ai_meeting_guides
        WHERE google_event_id = ?
        LIMIT 1
      `,
    )
    .get(googleEventId);

  if (!row) {
    return aiMeetingGuideBindingSchema.parse({
      guide: null,
      locked: false,
    });
  }

  return aiMeetingGuideBindingSchema.parse({
    guide: JSON.parse(row.guide_json),
    locked: true,
  });
};

export const registerAiRoutes = (app: import("fastify").FastifyInstance) => {
  app.get(
    "/ai/meeting-guide/:meetingId",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const meetingId = (request.params as { meetingId: string }).meetingId;
      const meeting = getMeetingById(meetingId);

      if (!meeting) {
        return reply.notFound("Meeting not found");
      }

      return getBoundGuideByGoogleEventId(meeting.googleEventId);
    },
  );

  app.post(
    "/ai/meeting-guide",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      if (!openai) {
        return reply.status(503).send({
          message:
            "OpenAI is not configured yet. Add OPENAI_API_KEY to apps/api/.env to enable AI meeting guides.",
        });
      }

      const input = aiMeetingGuideRequestSchema.parse(request.body);
      const meeting = getMeetingById(input.meetingId);

      if (!meeting) {
        return reply.notFound("Meeting not found");
      }

      const tools = env.openAiVectorStoreId
        ? [
            {
              type: "file_search" as const,
              vector_store_ids: [env.openAiVectorStoreId],
              max_num_results: 5,
            },
          ]
        : undefined;

      const response = await openai.responses.parse({
        model: env.openAiModel,
        input: [
          {
            role: "developer",
            content:
              "You are OpsUI's internal demo preparation agent. Generate a practical, concise, trustworthy guide for the meeting owner. Keep the advice action-oriented and aligned to the meeting brief. Never fabricate missing facts.",
          },
          {
            role: "user",
            content: buildGuidePrompt(meeting),
          },
        ],
        tools,
        text: {
          format: zodTextFormat(
            aiMeetingGuideContentSchema,
            "opsui_meeting_guide",
            {
              description:
                "Structured meeting guide for an OpsUI sales or demo rep.",
            },
          ),
          verbosity: "medium",
        },
      });

      if (!response.output_parsed) {
        return reply.badRequest("The AI guide could not be generated.");
      }

      return aiMeetingGuideSchema.parse({
        ...response.output_parsed,
        generatedAt: new Date().toISOString(),
        model: env.openAiModel,
      });
    },
  );

  app.post(
    "/ai/meeting-guide/:meetingId/save",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const meetingId = (request.params as { meetingId: string }).meetingId;
      const meeting = getMeetingById(meetingId);
      const currentUser = request.user;

      if (!meeting) {
        return reply.notFound("Meeting not found");
      }

      if (!currentUser) {
        return reply.unauthorized("Missing authenticated user");
      }

      const guide = aiMeetingGuideSchema.parse(request.body);
      const timestamp = new Date().toISOString();

      db.prepare(
        `
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
        `,
      ).run(
        meeting.googleEventId,
        JSON.stringify(guide),
        currentUser.id,
        timestamp,
        timestamp,
      );

      return aiMeetingGuideBindingSchema.parse({
        guide,
        locked: true,
      });
    },
  );

  app.post(
    "/ai/meeting-guide/:meetingId/unlock",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const meetingId = (request.params as { meetingId: string }).meetingId;
      const meeting = getMeetingById(meetingId);

      if (!meeting) {
        return reply.notFound("Meeting not found");
      }

      db.prepare(
        "DELETE FROM ai_meeting_guides WHERE google_event_id = ?",
      ).run(meeting.googleEventId);

      return aiMeetingGuideBindingSchema.parse({
        guide: null,
        locked: false,
      });
    },
  );
};

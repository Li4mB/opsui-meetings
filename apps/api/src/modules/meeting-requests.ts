import {
  createMeetingRequestInputSchema,
  meetingRequestSchema,
} from "@opsui/shared";
import { nanoid } from "nanoid";
import { storage } from "../db/database.js";
import { env } from "../config/env.js";
import { authenticateRequest } from "./auth.js";
import type { DbMeetingRequestRow } from "../types.js";

const toMeetingRequest = (row: DbMeetingRequestRow) =>
  meetingRequestSchema.parse({
    id: row.id,
    clientName: row.client_name,
    email: row.email,
    phone: row.phone,
    companyName: row.company_name,
    country: row.country,
    businessSize: row.business_size,
    modules: JSON.parse(row.modules_json) as string[],
    meetingMode: row.meeting_mode,
    preferredDate: row.preferred_date,
    preferredTime: row.preferred_time,
    additionalInfo: row.additional_info,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
  });

const moduleSlugMap: Record<string, string> = {
  "Order Management": "orders",
  "Inventory Management": "inventory",
  "Receiving/Inbound": "receiving-inbound",
  "Shipping/Outbound": "shipping-outbound",
  "Cycle Counting": "cycle-counting",
  "Wave Picking": "wave-picking",
  "Zone Picking": "zone-picking",
  "Slotting Optimization": "slotting-optimization",
  "Route Optimization": "route-optimization",
  "Quality Control": "quality-control",
  "Exceptions Management": "exceptions-management",
  "Business Rules Engine": "business-rules-engine",
  "Dashboards & Reporting": "dashboards-reporting",
  "ML/AI Predictions": "ml-ai-predictions",
  "Finance & Accounting": "finance-accounting",
  "Human Resources": "human-resources",
  "Production/Manufacturing": "production-manufacturing",
  Procurement: "procurement",
  "Maintenance Management": "maintenance-management",
  "Returns Management (RMA)": "returns-management-rma",
};

const normaliseBusinessSize = (size: string) =>
  size.replace(/\s*employees?$/i, "").trim();

const toMakeMeetingType = (meetingMode: "google_meet" | "in_person") =>
  meetingMode === "google_meet" ? "remote" : "in_person";

const toMakeDatetime = (date: string, time: string) => {
  const normalisedTime =
    time.length === 5 ? `${time}:00` : time;

  return `${date}T${normalisedTime}`;
};

const sendMeetingRequestWebhook = async (
  meetingRequest: ReturnType<typeof toMeetingRequest>,
  requestedBy: {
    id: string;
    username: string;
    displayName: string;
    role: string;
  },
) => {
  if (!env.makeMeetingRequestWebhookUrl) {
    return;
  }

  const response = await fetch(env.makeMeetingRequestWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: meetingRequest.id,
      name: meetingRequest.clientName,
      email: meetingRequest.email,
      phone: meetingRequest.phone,
      company: meetingRequest.companyName,
      size: normaliseBusinessSize(meetingRequest.businessSize),
      modules: meetingRequest.modules.map(
        (module) => moduleSlugMap[module] ?? module,
      ),
      type: toMakeMeetingType(meetingRequest.meetingMode),
      date: meetingRequest.preferredDate,
      time: meetingRequest.preferredTime,
      info: meetingRequest.additionalInfo,
      country: meetingRequest.country,
      datetime: toMakeDatetime(
        meetingRequest.preferredDate,
        meetingRequest.preferredTime,
      ),
      requestedBy,
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Make webhook failed with status ${response.status}${responseText ? `: ${responseText}` : ""}`,
    );
  }
};

export const registerMeetingRequestRoutes = (
  app: import("fastify").FastifyInstance,
) => {
  app.post(
    "/meeting-requests",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const currentUser = request.user;

      if (!currentUser) {
        return reply.unauthorized("Missing authenticated user");
      }

      const input = createMeetingRequestInputSchema.parse(request.body);
      const createdAt = new Date().toISOString();
      const id = nanoid();

      await storage.insertMeetingRequest({
        id,
        client_name: input.clientName,
        email: input.email,
        phone: input.phone,
        company_name: input.companyName,
        country: input.country,
        business_size: input.businessSize,
        modules_json: JSON.stringify(input.modules),
        meeting_mode: input.meetingMode,
        preferred_date: input.preferredDate,
        preferred_time: input.preferredTime,
        additional_info: input.additionalInfo,
        created_by_user_id: currentUser.id,
        created_at: createdAt,
      } satisfies DbMeetingRequestRow);

      const row = await storage.findMeetingRequestById(id);

      if (!row) {
        return reply.status(500).send({
          message: "Meeting request was created but could not be loaded.",
        });
      }

      const meetingRequest = toMeetingRequest(row);

      try {
        await sendMeetingRequestWebhook(meetingRequest, {
          id: currentUser.id,
          username: currentUser.username,
          displayName: currentUser.displayName,
          role: currentUser.role,
        });
      } catch (error) {
        await storage.deleteMeetingRequestById(id);

        return reply.status(502).send({
          message:
            error instanceof Error
              ? error.message
              : "Unable to deliver the meeting request to Make.",
        });
      }

      return meetingRequest;
    },
  );
};

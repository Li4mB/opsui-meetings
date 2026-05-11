import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import {
  aiMeetingGuideContentSchema,
  aiMeetingGuideBindingSchema,
  aiMeetingGuideRequestSchema,
  aiMeetingGuideSchema,
  aiPostContentRequestSchema,
  aiPostContentSchema,
  aiPostImageRequestSchema,
  aiPostImageSchema,
  meetingSchema,
} from "@opsui/shared";
import { storage } from "../db/database.js";
import { env } from "../config/env.js";
import { authenticateRequest } from "./auth.js";
import type {
  DbAiMeetingGuideRow,
} from "../types.js";
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

const normalizeTags = (tags: string[]) =>
  tags
    .map((tag) => tag.trim().replace(/^#/, "").toLowerCase())
    .filter(Boolean)
    .filter((tag, index, allTags) => allTags.indexOf(tag) === index)
    .slice(0, 12);

const buildPostContentPrompt = (input: {
  prompt: string;
  currentCaption?: string;
  imageNames: string[];
  tags: string[];
}) =>
  [
    "Create social post content from the user's prompt.",
    "Do not copy the prompt directly into the caption.",
    "Write a polished, post-ready caption that suits the prompt, image context, and brand tone.",
    "If the prompt asks for a poster or visual concept, make the caption support the visual instead of repeating every design instruction.",
    "Return relevant lowercase tags without # symbols.",
    "",
    `Prompt:\n${input.prompt}`,
    input.currentCaption ? `Current caption:\n${input.currentCaption}` : "",
    input.imageNames.length ? `Images:\n${input.imageNames.join(", ")}` : "Images: none",
    input.tags.length ? `Existing tags:\n${input.tags.join(", ")}` : "Existing tags: none",
  ]
    .filter(Boolean)
    .join("\n\n");

const buildImagePrompt = (input: {
  prompt: string;
  caption?: string;
  tags: string[];
}) =>
  [
    "Generate one premium social media image for OpsUI based on the user prompt.",
    "Do not paste the full prompt into the image.",
    "Use only short, intentional poster copy if text is needed.",
    "Keep the image clean, bold, and instantly readable.",
    "For CRM / sales pipeline prompts: create a high-end dark cinematic SaaS poster, #0A0A0F background, white typography, purple #7B5CFF glow, subtle cyberpunk UI, one dominant message, split CRM view vs reality if requested.",
    "",
    `User prompt:\n${input.prompt}`,
    input.caption ? `Caption context:\n${input.caption}` : "",
    input.tags.length ? `Tags:\n${input.tags.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

const generatePostImageWithFallback = async (prompt: string) => {
  const imageModels = [
    env.openAiImageModel,
    "gpt-image-1",
    "dall-e-3",
  ].filter((model, index, models) => model && models.indexOf(model) === index);
  let lastError: unknown;

  for (const model of imageModels) {
    try {
      const response = model === "dall-e-3"
        ? await openai?.images.generate({
            model,
            prompt,
            n: 1,
            size: "1792x1024",
            quality: "hd",
            response_format: "b64_json",
            style: "vivid",
          })
        : await openai?.images.generate({
            model,
            prompt,
            n: 1,
            size: "1536x1024",
            quality: "high",
            output_format: "jpeg",
          });
      const imageData = response?.data?.[0]?.b64_json;

      if (imageData) {
        return {
          imageData,
          model,
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("The post image could not be generated.");
};

const getMeetingById = async (meetingId: string) => {
  const row = await storage.findMeetingByIdIncludingPast(meetingId);
  return row ? toMeeting(row) : null;
};

const getBoundGuideByGoogleEventId = async (googleEventId: string) => {
  const row = await storage.getAiMeetingGuideByGoogleEventId(googleEventId);

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
  app.post(
    "/ai/post-content",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      if (!openai) {
        return reply.status(503).send({
          message:
            "OpenAI is not configured yet. Add OPENAI_API_KEY to apps/api/.env to enable post generation.",
        });
      }

      const input = aiPostContentRequestSchema.parse(request.body);
      const response = await openai.responses.parse({
        model: env.openAiModel,
        input: [
          {
            role: "developer",
            content:
              "You are OpsUI's social content generator. Produce concise, premium SaaS marketing captions and relevant tags. Never copy the full prompt as the caption.",
          },
          {
            role: "user",
            content: buildPostContentPrompt(input),
          },
        ],
        text: {
          format: zodTextFormat(aiPostContentSchema.omit({
            generatedAt: true,
            model: true,
          }), "opsui_post_content"),
          verbosity: "medium",
        },
      });

      if (!response.output_parsed) {
        return reply.badRequest("The post content could not be generated.");
      }

      return aiPostContentSchema.parse({
        ...response.output_parsed,
        tags: normalizeTags(response.output_parsed.tags),
        generatedAt: new Date().toISOString(),
        model: env.openAiModel,
      });
    },
  );

  app.post(
    "/ai/post-image",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      if (!openai) {
        return reply.status(503).send({
          message:
            "OpenAI is not configured yet. Add OPENAI_API_KEY to apps/api/.env to enable image generation.",
        });
      }

      const input = aiPostImageRequestSchema.parse(request.body);
      const tags = normalizeTags(input.tags);
      const generatedImage = await generatePostImageWithFallback(
        buildImagePrompt({
          prompt: input.prompt,
          caption: input.caption,
          tags,
        }),
      );

      return aiPostImageSchema.parse({
        imageDataUrl: `data:image/jpeg;base64,${generatedImage.imageData}`,
        fileName: `opsui-post-${Date.now()}.jpg`,
        tags,
        generatedAt: new Date().toISOString(),
        model: generatedImage.model,
      });
    },
  );

  app.get(
    "/ai/meeting-guide/:meetingId",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const meetingId = (request.params as { meetingId: string }).meetingId;
      const meeting = await getMeetingById(meetingId);

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
      const meeting = await getMeetingById(input.meetingId);

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
      const meeting = await getMeetingById(meetingId);
      const currentUser = request.user;

      if (!meeting) {
        return reply.notFound("Meeting not found");
      }

      if (!currentUser) {
        return reply.unauthorized("Missing authenticated user");
      }

      const guide = aiMeetingGuideSchema.parse(request.body);
      const timestamp = new Date().toISOString();

      await storage.upsertAiMeetingGuide({
        google_event_id: meeting.googleEventId,
        guide_json: JSON.stringify(guide),
        created_by_user_id: currentUser.id,
        created_at: timestamp,
        updated_at: timestamp,
      } satisfies DbAiMeetingGuideRow);

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
      const meeting = await getMeetingById(meetingId);

      if (!meeting) {
        return reply.notFound("Meeting not found");
      }

      await storage.deleteAiMeetingGuideByGoogleEventId(meeting.googleEventId);

      return aiMeetingGuideBindingSchema.parse({
        guide: null,
        locked: false,
      });
    },
  );
};

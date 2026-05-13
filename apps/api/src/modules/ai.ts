import fs from "node:fs";
import path from "node:path";
import OpenAI, { toFile } from "openai";
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

const opsUiLogoReferencePath = path.resolve(
  env.appRoot,
  "assets",
  "opsui-logo-reference.png",
);
const opsUiLogoReferenceDataUrl = (() => {
  try {
    return `data:image/png;base64,${fs.readFileSync(opsUiLogoReferencePath, "base64")}`;
  } catch {
    return null;
  }
})();

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
    .map((tag) => tag.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
    .filter((tag, index, allTags) => allTags.indexOf(tag) === index)
    .slice(0, 12);

const normalizeHashtagBank = (tags: string[]) =>
  tags
    .map((tag) => tag.trim().replace(/^#/, "").toLowerCase())
    .map((tag) => tag.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
    .filter((tag, index, allTags) => allTags.indexOf(tag) === index)
    .slice(0, 24);

const postPlatformLabels = {
  general: "General cross-platform",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  twitter: "Twitter/X",
  instagram: "Instagram",
} as const;

const opsUiSocialDirection = [
  "Brand: OpsUI is a serious, modern warehouse management and ERP platform built for businesses that need more control over stock, orders, dispatch, reporting, and daily operations.",
  "Audience: Business owners, warehouse managers, operations managers, distributors, wholesalers, manufacturers, 3PLs, and growing companies in Australia and New Zealand.",
  "Goal: Build trust, educate the market, and show that OpsUI understands real operational problems. Create interest in a conversation, demo, or enquiry without sounding pushy.",
  "Tone: Confident, practical, sharp, professional, and easy to understand. Premium but not flashy. Technical but not confusing. Direct but still human.",
  "Focus areas: warehouse visibility, stock accuracy, order flow, picking, packing, dispatch, operational control, scaling beyond spreadsheets, ERP and WMS problems, real business pain points.",
  "Avoid: Generic SaaS buzzwords, hype, overpromising, childish language, hard selling.",
  "Core message: OpsUI helps operational businesses move from manual chaos to clearer control, better visibility, and scalable execution.",
].join("\n");

const opsUiLogoDirection = [
  "Logo rule: If the generated image includes an OpsUI logo, product logo, brand mark, app icon, watermark, or corner bug, use only the supplied OP logo reference image.",
  "The correct logo is a square purple background with bold white uppercase OP letters. Keep the mark clean, flat, and readable.",
  "Do not invent alternate OpsUI marks, do not use the old glowing black OP icon, and do not recolor or distort the OP logo.",
  "If accurate logo placement is not possible, omit the logo instead of creating an incorrect logo.",
].join("\n");

const captionStrategistPrompt = [
  "Act as a senior social media strategist and copywriter.",
  "",
  "Your job is to turn the user's rough idea into a platform-optimised caption for the social media platform they choose.",
  "",
  "Before writing, analyse internally:",
  "- The platform's audience behaviour",
  "- The best caption structure for that platform",
  "- The emotional angle that will create engagement",
  "- The best hook style",
  "- The best hashtags for reach and relevance",
  "",
  "Caption rules:",
  "- Make it sound natural, confident, and platform-native.",
  "- Start with a strong hook.",
  "- Use clean formatting and line breaks.",
  "- Make the message easy to skim.",
  "- Include a CTA that fits the goal.",
  "- Add relevant hashtags.",
  "- Use as many hashtags as are useful for reach, but do not include irrelevant or low-quality hashtags.",
  "- Do not use cringe, fake hype, or generic AI-sounding phrases.",
  "- Make it feel human, polished, and ready to post.",
  "",
  "Return structured fields only: best final caption, 3 alternative captions, hashtag bank, best posting style recommendation, and suggested CTA options.",
].join("\n");

const buildPostContentPrompt = (input: {
  prompt: string;
  platform: keyof typeof postPlatformLabels;
  currentCaption?: string;
  tweakInstruction?: string;
  imageNames: string[];
  tags: string[];
}) =>
  [
    "Create OpsUI social media content from the user's prompt.",
    "Use the fixed OpsUI social direction exactly. Do not ask for missing brand, audience, goal, or tone fields.",
    "If a tweak instruction is provided, revise the current caption only for the selected platform while preserving the core message.",
    "Return hashtagBank values without # symbols.",
    "",
    "Fixed OpsUI social direction:",
    opsUiSocialDirection,
    "",
    `Platform:\n${postPlatformLabels[input.platform]}`,
    `Prompt:\n${input.prompt}`,
    input.currentCaption ? `Current caption:\n${input.currentCaption}` : "",
    input.tweakInstruction ? `Tweak instruction:\n${input.tweakInstruction}` : "",
    input.imageNames.length ? `Images:\n${input.imageNames.join(", ")}` : "Images: none",
    input.tags.length ? `Existing hashtags:\n${input.tags.join(", ")}` : "Existing hashtags: none",
  ]
    .filter(Boolean)
    .join("\n\n");

const buildImagePrompt = (input: {
  prompt: string;
  caption?: string;
  tags: string[];
}) =>
  [
    "Create one premium portrait social media image for OpsUI based on the user prompt.",
    "Use creative freedom. The image should feel like a serious, modern WMS/ERP campaign asset, not a generic template.",
    "Visual direction: dark premium SaaS/operations aesthetic, clear hierarchy, practical warehouse/ERP/WMS context, crisp UI realism, controlled contrast, clean modern typography, and one dominant message if text is used.",
    "Do not paste the full prompt into the image. Use only short, intentional poster copy when useful.",
    "Avoid childish visuals, fake hype, clutter, irrelevant stock imagery, and unreadable text.",
    "",
    "Logo direction:",
    opsUiLogoDirection,
    "",
    "Fixed OpsUI social direction:",
    opsUiSocialDirection,
    "",
    `User prompt:\n${input.prompt}`,
    input.caption ? `Caption context:\n${input.caption}` : "",
    input.tags.length ? `Tags:\n${input.tags.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

const uniqueModels = (models: string[]) =>
  models.filter((model, index, allModels) => model && allModels.indexOf(model) === index);

const findResponsesImageData = (response: unknown) => {
  const output = (response as {
    output?: Array<{
      type?: string;
      result?: string | null;
    }>;
  }).output ?? [];
  const imageCall = output.find(
    (item) => item.type === "image_generation_call" && item.result,
  );

  return imageCall?.result ?? null;
};

const buildResponsesImageInput = (prompt: string) => {
  const userContent: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "high" }
  > = [{ type: "input_text", text: prompt }];

  if (opsUiLogoReferenceDataUrl) {
    userContent.push({
      type: "input_image",
      image_url: opsUiLogoReferenceDataUrl,
      detail: "high",
    });
  }

  return [
    {
      role: "developer" as const,
      content: [
        {
          type: "input_text" as const,
          text: [
            "Use the image_generation tool to create one premium portrait social media image for OpsUI.",
            "Use the attached OP logo reference whenever the output needs a logo or brand mark.",
            "Return the generated image only.",
          ].join(" "),
        },
      ],
    },
    {
      role: "user" as const,
      content: userContent,
    },
  ];
};

const getLogoReferenceUpload = async () => {
  if (!fs.existsSync(opsUiLogoReferencePath)) {
    return null;
  }

  return toFile(
    fs.createReadStream(opsUiLogoReferencePath),
    "opsui-logo-reference.png",
    { type: "image/png" },
  );
};

const generatePostImageViaResponses = async (prompt: string) => {
  if (!openai) {
    throw new Error("OpenAI is not configured.");
  }

  const response = await openai.responses.create({
    model: env.openAiImageReasoningModel,
    input: buildResponsesImageInput(prompt),
    tools: [
      {
        type: "image_generation",
        model: env.openAiImageModel,
        size: "1024x1536",
        quality: "high",
        output_format: "jpeg",
      },
    ],
  });
  const imageData = findResponsesImageData(response);

  if (!imageData) {
    throw new Error("The Responses image tool did not return image data.");
  }

  return {
    imageData,
    model: `${env.openAiImageReasoningModel}+${env.openAiImageModel}`,
  };
};

const generatePostImageWithFallback = async (prompt: string) => {
  if (!openai) {
    throw new Error("OpenAI is not configured.");
  }

  const imageModels = uniqueModels([
    env.openAiImageModel,
    "gpt-image-1.5",
    "gpt-image-1",
  ]);
  let lastError: unknown;

  try {
    return await generatePostImageViaResponses(prompt);
  } catch (error) {
    lastError = error;
  }

  for (const model of imageModels) {
    try {
      let response;

      if (model === "dall-e-3") {
        response = await openai?.images.generate({
          model,
          prompt,
          n: 1,
          size: "1024x1792",
          quality: "hd",
          response_format: "b64_json",
          style: "vivid",
        });
      } else {
        const logoReferenceUpload = await getLogoReferenceUpload();

        response = logoReferenceUpload
          ? await openai?.images.edit({
              model,
              image: logoReferenceUpload,
              prompt,
              n: 1,
              size: "1024x1536",
              quality: "high",
              output_format: "jpeg",
              input_fidelity: "high",
            })
          : await openai?.images.generate({
              model,
              prompt,
              n: 1,
              size: "1024x1536",
              quality: "high",
              output_format: "jpeg",
            });
      }
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
        model: env.openAiCaptionModel,
        input: [
          {
            role: "developer",
            content: captionStrategistPrompt,
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
        hashtagBank: normalizeHashtagBank(response.output_parsed.hashtagBank),
        generatedAt: new Date().toISOString(),
        model: env.openAiCaptionModel,
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

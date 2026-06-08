import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import sharp from "sharp";
import { zodTextFormat } from "openai/helpers/zod";
import { nanoid } from "nanoid";
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
import type { AiPostImageStyle } from "@opsui/shared";
import { storage } from "../db/database.js";
import { env } from "../config/env.js";
import { authenticateRequest } from "./auth.js";
import type {
  DbAiMeetingGuideRow,
  DbAiPostImageGenerationRow,
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

const readAssetDataUrl = (filePath: string, mimeType: string) => {
  try {
    return `data:${mimeType};base64,${fs.readFileSync(filePath, "base64")}`;
  } catch {
    return null;
  }
};


const opsUiVisualReferences = [
  {
    label: "OpsUI app dashboard screenshot from the marketing home page",
    dataUrl: readAssetDataUrl(
      path.resolve(env.appRoot, "assets", "opsui-app-home-dashboard-reference.jpg"),
      "image/jpeg",
    ),
  },
  {
    label: "OpsUI app order management module screenshot",
    dataUrl: readAssetDataUrl(
      path.resolve(env.appRoot, "assets", "opsui-app-module-order-management-reference.jpg"),
      "image/jpeg",
    ),
  },
  {
    label: "OpsUI app inventory management module screenshot",
    dataUrl: readAssetDataUrl(
      path.resolve(env.appRoot, "assets", "opsui-app-module-inventory-management-reference.jpg"),
      "image/jpeg",
    ),
  },
  {
    label: "OpsUI app receiving inbound module screenshot",
    dataUrl: readAssetDataUrl(
      path.resolve(env.appRoot, "assets", "opsui-app-module-receiving-inbound-reference.jpg"),
      "image/jpeg",
    ),
  },
  {
    label: "OpsUI app shipping outbound module screenshot",
    dataUrl: readAssetDataUrl(
      path.resolve(env.appRoot, "assets", "opsui-app-module-shipping-outbound-reference.jpg"),
      "image/jpeg",
    ),
  },
  {
    label: "OpsUI app dashboards reporting module screenshot",
    dataUrl: readAssetDataUrl(
      path.resolve(env.appRoot, "assets", "opsui-app-module-dashboards-reporting-reference.jpg"),
      "image/jpeg",
    ),
  },
  {
    label: "OpsUI app cycle counting module screenshot",
    dataUrl: readAssetDataUrl(
      path.resolve(env.appRoot, "assets", "opsui-app-module-cycle-counting-reference.jpg"),
      "image/jpeg",
    ),
  },
  {
    label: "OpsUI app wave picking module screenshot",
    dataUrl: readAssetDataUrl(
      path.resolve(env.appRoot, "assets", "opsui-app-module-wave-picking-reference.jpg"),
      "image/jpeg",
    ),
  },
  {
    label: "OpsUI app zone picking module screenshot",
    dataUrl: readAssetDataUrl(
      path.resolve(env.appRoot, "assets", "opsui-app-module-zone-picking-reference.jpg"),
      "image/jpeg",
    ),
  },
  {
    label: "OpsUI app slotting optimisation module screenshot",
    dataUrl: readAssetDataUrl(
      path.resolve(env.appRoot, "assets", "opsui-app-module-slotting-optimization-reference.jpg"),
      "image/jpeg",
    ),
  },
  {
    label: "OpsUI app route optimisation module screenshot",
    dataUrl: readAssetDataUrl(
      path.resolve(env.appRoot, "assets", "opsui-app-module-route-optimization-reference.jpg"),
      "image/jpeg",
    ),
  },
  {
    label: "OpsUI app returns management module screenshot",
    dataUrl: readAssetDataUrl(
      path.resolve(env.appRoot, "assets", "opsui-app-module-returns-management-reference.jpg"),
      "image/jpeg",
    ),
  },
].filter((reference): reference is { label: string; dataUrl: string } =>
  Boolean(reference.dataUrl),
);

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

// The real OP logo is composited onto the image after generation (pixel
// perfect), so the model must NOT draw one — it only reserves a clean corner.
const buildLogoReserveDirection = (cornerLabel: string) =>
  [
    "Logo rule (added in post-production): do NOT draw, render, paint, recreate, or imagine any OpsUI logo, OP mark, wordmark, app icon, watermark, or brand bug anywhere in the image.",
    `Leave the ${cornerLabel} corner as a clean, calm, unobstructed area (roughly the corner 20% of the width) with no text, graphics, or busy detail. The official OpsUI logo is composited into that corner afterwards.`,
    "Any logo you draw would be a duplicate of the real one and must therefore be omitted entirely.",
  ].join("\n");

const opsUiUiReferenceDirection = [
  "OpsUI UI reference rule (reference-lock): if the image includes any app screen, dashboard, module view, chart, table, navigation, panel, metric card, or other interface element, use the attached OpsUI app screenshots themselves and reproduce them verbatim, pixel-for-pixel.",
  "Treat each screenshot as a fixed, finished asset that is copied and pasted in as-is. Preserve exactly its layout, rows, columns, labels, metrics, typography, and colours. The screenshots are real OpsUI app UI from opsui.app, hosted on the OpsUI marketing site at opsui.au under the main dashboard section and module pages.",
  "Do not redraw, restyle, recolour, re-typeset, crop, distort, or reflow the UI, and do not invent fake OpsUI product screens, fake dashboards, fake tables, fake metrics, fake menu items, fake module layouts, or fake UI copy that is not present in the attached app screenshots.",
  "Use the dashboard screenshot for dashboard/KPI/reporting visuals. Use the specific module screenshots for order, inventory, receiving, shipping, cycle counting, wave picking, zone picking, slotting, routing, and returns visuals. Place UI large, flat, and upright so text and fine detail are not re-synthesised.",
  "If the concept needs UI but no matching OpsUI app screenshot exists, avoid UI and create a brand-safe operational poster, warehouse/process scene, product-message graphic, or logo-led composition instead. If a screenshot cannot be reproduced faithfully, omit it rather than approximate it.",
].join("\n");

const opsUiRealisticStyleDirection = [
  "The image should feel like a serious, modern WMS/ERP campaign asset, not a generic template.",
  "Visual direction: premium SaaS/operations aesthetic, clear hierarchy, practical warehouse/ERP/WMS context, controlled contrast, clean modern typography for any new poster copy, and one dominant message if text is used.",
].join("\n");

// Premium enterprise LinkedIn poster style. This is a reusable art direction:
// the aesthetic, composition, lighting, typography, and content structure are
// fixed, while the actual label/headline/copy/cost come from the user prompt.
const opsUiPremiumPosterDirection = [
  "Premium enterprise poster style (Apple x Linear x Stripe x high-end SaaS campaign aesthetic): it must look like a billion-dollar enterprise software company advertising to executives on LinkedIn. Make it look real, expensive, and believable.",
  "Mood: minimalistic luxury enterprise, sophisticated B2B SaaS branding, elegant operational-tech atmosphere.",
  "Background: dark near-black fading into deep violet gradients; smooth cinematic gradients; soft radial lighting; soft ambient purple glow; soft bloom; ultra-subtle vignette; realistic screen-space glow; purple edge glow.",
  "Composition: 1:1 square, ultra high resolution, left-heavy. Top-left: leave a clean empty corner reserved for the OpsUI logo (it is added in post — do not draw it). Left side: a huge oversized bold headline with intentional whitespace. Right side only: an abstract operational visual that balances the typography. Bottom-right: cost emphasis.",
  "Right-side visual: glowing operational geometry only — thin connection lines, network curves, system nodes, architectural arcs, subtle topology graphics, enterprise infrastructure symbolism. Use purple accent strokes and edge glow. Keep it abstract and subtle; it is never an app UI.",
  "Surfaces: subtle glassmorphism panels, thin divider/separator lines, generous intentional whitespace, sharp typography hierarchy.",
  "Typography: gigantic bold headline in a clean modern grotesk sans-serif with tight line spacing; thin uppercase micro-labels with wide letter spacing; smaller muted supporting copy.",
  "Bottom alignment: elegant spacing blocks with a footer aligned exactly like luxury B2B campaigns.",
  "Hard nos: NO clutter, NO fake dashboards, NO generic AI SaaS UI, NO random stock illustrations, NO busy backgrounds. Minimal iconography only if extremely subtle.",
  "",
  "Poster content structure — write concise, executive, OpsUI-voice copy. Take the actual wording from the user prompt when it specifies it; otherwise write fitting operational-economics copy in OpsUI's voice:",
  "- A small uppercase micro-label (example: \"OPERATIONAL ECONOMICS\").",
  "- A short, punchy headline broken across 2-3 lines (example: \"Your operation\" / \"shouldn't rely\" / \"on copy paste.\").",
  "- 2-3 lines of muted supporting copy explaining the operational insight (example: \"Most warehouse coordination work exists because systems fail to communicate properly.\").",
  "- A single bottom insight line (example: \"Manual reconciliation is operational debt.\").",
  "- A cost callout box with a large currency figure and a small caption beneath it (example: \"≈ NZ$140,000\" / \"avoidable annual coordination overhead\").",
  "- Footer, bottom aligned: \"— Heinricht, OpsUI\" on one line and \"opsui.co.nz\" beneath it.",
].join("\n");

type LogoCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

type ImageStyleConfig = {
  // gpt-image / Responses image_generation size.
  size: "1024x1024" | "1024x1536";
  // dall-e-3 fallback size (different allowed set).
  dalleSize: "1024x1024" | "1024x1792";
  // Whether to attach the OpsUI app screenshots as reference images.
  includeUiReferences: boolean;
  // Corner where the real OP logo is composited after generation.
  logoCorner: LogoCorner;
};

const imageStyleConfig: Record<AiPostImageStyle, ImageStyleConfig> = {
  realistic: {
    size: "1024x1536",
    dalleSize: "1024x1792",
    includeUiReferences: true,
    logoCorner: "bottom-left",
  },
  premium: {
    size: "1024x1024",
    dalleSize: "1024x1024",
    includeUiReferences: false,
    logoCorner: "top-left",
  },
};

const cornerLabel = (corner: LogoCorner) => corner.replace("-", " ");

const buildStyleArtDirection = (style: AiPostImageStyle) => {
  const logoReserveDirection = buildLogoReserveDirection(
    cornerLabel(imageStyleConfig[style].logoCorner),
  );

  if (style === "premium") {
    return [
      "Style: PREMIUM ENTERPRISE POSTER.",
      opsUiPremiumPosterDirection,
      "",
      "No app UI for this style: do not include any OpsUI app screenshots, dashboards, tables, charts, or product UI. Use abstract operational geometry instead. No app screenshots are attached for this style.",
      "",
      "Logo direction:",
      logoReserveDirection,
    ];
  }

  return [
    "Style: REALISTIC.",
    opsUiRealisticStyleDirection,
    "",
    "UI reference direction:",
    opsUiUiReferenceDirection,
    "",
    "Logo direction:",
    logoReserveDirection,
  ];
};

const opsUiAppReferenceUrls = [
  "https://opsui.app/",
];

const opsUiScreenshotSourceUrls = [
  "https://opsui.au/",
  "https://opsui.au/modules/order-management",
  "https://opsui.au/modules/inventory-management",
  "https://opsui.au/modules/receiving-inbound",
  "https://opsui.au/modules/shipping-outbound",
  "https://opsui.au/modules/dashboards-reporting",
  "https://opsui.au/modules/cycle-counting",
  "https://opsui.au/modules/wave-picking",
  "https://opsui.au/modules/zone-picking",
  "https://opsui.au/modules/slotting-optimization",
  "https://opsui.au/modules/route-optimization",
  "https://opsui.au/modules/returns-management",
];

const fallbackOpsUiAppContext = [
  "OpsUI app source: https://opsui.app/",
  "OpsUI is an enterprise resource planning system with operational modules for order management, inventory, receiving/inbound, shipping/outbound, dashboards/reporting, cycle counting, wave picking, zone picking, slotting optimisation, route optimisation, and returns management.",
  "The attached OpsUI app screenshots are the only source of OpsUI UI; reproduce them verbatim and never derive, infer, or invent UI patterns from them. Treat opsui.au only as the screenshot host, not as permission to invent marketing-page UI inside product screenshots.",
  `Screenshot source pages: ${opsUiScreenshotSourceUrls.join(", ")}`,
].join("\n");

let opsUiAppContextCache:
  | { fetchedAt: number; context: string }
  | null = null;

const trimForPrompt = (value: string, maxLength: number) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;

const parseGenerationTags = (tagsJson: string) => {
  try {
    const tags = JSON.parse(tagsJson) as unknown;

    return Array.isArray(tags)
      ? tags.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
};

const stripHtmlToText = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&mdash;|&#8212;/g, "-")
    .replace(/&ndash;|&#8211;/g, "-")
    .replace(/&rsquo;|&#8217;/g, "'")
    .replace(/&lsquo;|&#8216;/g, "'")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const fetchOpsUiAppContext = async () => {
  const now = Date.now();

  if (
    opsUiAppContextCache &&
    now - opsUiAppContextCache.fetchedAt < 1000 * 60 * 60 * 6
  ) {
    return opsUiAppContextCache.context;
  }

  const settledPages = await Promise.allSettled(
    opsUiAppReferenceUrls.map(async (url) => {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "OpsUI social image app reference fetcher",
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`Could not fetch ${url} (${response.status})`);
      }

      return `Source: ${url}\n${trimForPrompt(stripHtmlToText(await response.text()), 3000)}`;
    }),
  );

  const fetchedContext = settledPages
    .filter(
      (result): result is PromiseFulfilledResult<string> =>
        result.status === "fulfilled" && result.value.length > 0,
    )
    .map((result) => result.value)
    .join("\n\n");
  const context = [
    fetchedContext || fallbackOpsUiAppContext,
    `OpsUI app screenshot source pages:\n${opsUiScreenshotSourceUrls.join("\n")}`,
  ].join("\n\n");

  opsUiAppContextCache = {
    fetchedAt: now,
    context: trimForPrompt(context, 9000),
  };

  return opsUiAppContextCache.context;
};

const formatImageGenerationHistory = (
  recentGenerations: DbAiPostImageGenerationRow[],
) => {
  if (!recentGenerations.length) {
    return "";
  }

  return recentGenerations
    .slice()
    .reverse()
    .map((generation, index) => {
      const tags = parseGenerationTags(generation.tags_json);

      return [
        `${index + 1}. ${generation.created_at}`,
        `Prompt: ${trimForPrompt(generation.prompt, 420)}`,
        generation.caption
          ? `Caption: ${trimForPrompt(generation.caption, 280)}`
          : "",
        tags.length ? `Tags: ${tags.join(", ")}` : "",
        `Result: ${generation.image_name} via ${generation.image_model}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
};

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
  appContext: string;
  recentGenerations: DbAiPostImageGenerationRow[];
  style: AiPostImageStyle;
}) =>
  [
    "Create one premium social media image for OpsUI based on the user prompt and the selected style.",
    "Use creative freedom for the layout, background, scene, and composition only; never restyle, recolour, re-typeset, or modernise the attached reference assets. The reference-lock rules take priority over all art direction.",
    ...buildStyleArtDirection(input.style),
    "",
    "Do not paste the full prompt into the image. Use only short, intentional poster copy when useful.",
    "Avoid childish visuals, fake hype, clutter, irrelevant stock imagery, and unreadable text.",
    "",
    "Fixed OpsUI social direction:",
    opsUiSocialDirection,
    ...(input.style === "realistic"
      ? ["", "OpsUI app context:", input.appContext]
      : []),
    "",
    input.recentGenerations.length
      ? `Recent image generation context:\n${formatImageGenerationHistory(input.recentGenerations)}`
      : "",
    input.recentGenerations.length
      ? "Use the recent context to keep continuity in campaign language, visual direction, and avoided mistakes, while still following the latest user prompt."
      : "",
    "",
    `User prompt:\n${input.prompt}`,
    input.caption ? `Caption context:\n${input.caption}` : "",
    input.tags.length ? `Tags:\n${input.tags.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

const imageModelFileExtension = (model: string) =>
  model === "dall-e-3" ? "png" : "jpg";

const imageModelMimeType = (model: string) =>
  model === "dall-e-3" ? "image/png" : "image/jpeg";

// input_fidelity "high" forces the model to copy the supplied reference images
// in verbatim instead of loosely reinterpreting them. It is only a settable
// parameter on gpt-image-1 / gpt-image-1.5; passing it to gpt-image-1-mini,
// gpt-image-2, or dall-e-* returns a 400, so it must be guarded per model.
const supportsInputFidelity = (model: string) =>
  model === "gpt-image-1" || model === "gpt-image-1.5";

const fetchImageAsBase64 = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Generated image URL could not be downloaded (${response.status}).`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  return buffer.toString("base64");
};

const getGeneratedImageData = async (
  response:
    | {
        data?: Array<{
          b64_json?: string;
          url?: string;
        }>;
      }
    | undefined,
) => {
  const image = response?.data?.[0];

  if (image?.b64_json) {
    return image.b64_json;
  }

  if (image?.url) {
    return fetchImageAsBase64(image.url);
  }

  throw new Error("OpenAI returned no image data.");
};

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

const buildResponsesImageInput = (
  prompt: string,
  includeUiReferences: boolean,
) => {
  const userContent: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "high" }
  > = [{ type: "input_text", text: prompt }];

  // The OP logo is NOT attached to the model — it is composited onto the output
  // afterwards so it is always pixel perfect. The only references sent are the
  // OpsUI app screenshots, each labelled by index and locked to verbatim
  // reproduction.
  let referenceIndex = 0;
  let attachedScreenshotCount = 0;

  if (includeUiReferences) {
    for (const reference of opsUiVisualReferences) {
      referenceIndex += 1;
      attachedScreenshotCount += 1;
      userContent.push({
        type: "input_text",
        text: [
          `Image ${referenceIndex} = OpsUI app screenshot — ${reference.label}.`,
          "FIXED REFERENCE ASSET — copy and paste it in verbatim, pixel-for-pixel; it is final and immutable.",
          "Preserve exactly its layout, rows, columns, labels, metrics, typography, and colours.",
          "Do not redraw, restyle, recolour, crop, distort, reflow, or invent any metric, row, control, or copy that is not present in it. Use it only as OpsUI app UI, reproduced as-is.",
          "If it cannot be reproduced faithfully, omit it rather than alter it.",
        ].join(" "),
      });
      userContent.push({
        type: "input_image",
        image_url: reference.dataUrl,
        detail: "high",
      });
    }
  }

  const uiReferenceInstruction = attachedScreenshotCount > 0
    ? "Use the attached OpsUI app screenshots (labelled in the user message) for any UI, dashboard, module view, chart, table, metric card, navigation, typography, or layout, reproduced verbatim. The app is opsui.app; the screenshots are hosted on opsui.au module pages. Never fabricate OpsUI screens, metrics, menu items, or copy."
    : "No app screenshots are attached. Do not include any OpsUI app UI, dashboard, table, chart, or product screen; use abstract operational geometry instead, and never fabricate OpsUI UI.";

  return [
    {
      role: "developer" as const,
      content: [
        {
          type: "input_text" as const,
          text: [
            "Use the image_generation tool to create one premium portrait social media image for OpsUI.",
            "",
            "REFERENCE-LOCK RULES (highest priority; these override all style, creativity, and art-direction instructions).",
            "Treat every attached reference image as a FIXED, FINISHED ASSET to be copied and pasted in, not a subject to be generated, imagined, redrawn, or improved.",
            "Each attached reference image is an OpsUI app screenshot, labelled by index in the user message. Follow those labels exactly and refer to assets only by them.",
            "For EVERY reference image:",
            "- Reproduce it exactly, pixel-for-pixel, as supplied. It is final and immutable.",
            "- Preserve exactly its shape, proportions, colours and exact hex, typography, glyph spacing, internal layout, crop, and aspect ratio.",
            "- Do not recolour, restyle, redraw, re-render, re-typeset, simplify, modernise, or clean up.",
            "- Do not add gradients, shadows, glows, borders, or effects that are not already in the asset.",
            "- Do not crop, rotate, skew, mirror, stretch, distort, reflow, or add or remove any element inside it.",
            "- Do not invent text, data, labels, rows, charts, controls, or UI that is not present in the supplied asset.",
            "- Place it large, flat, and upright so no detail has to be re-synthesised.",
            "Do not draw, render, or recreate any OpsUI logo, OP mark, wordmark, app icon, watermark, or brand bug anywhere; leave the designated corner margin clean and unobstructed. The official logo is composited onto the image afterwards, so any logo you draw would be a duplicate and must be omitted.",
            uiReferenceInstruction,
            "Restate and obey these invariants on every regeneration; do not let the references drift.",
            "FAIL-SAFE: if any reference cannot be reproduced faithfully at the required size and fidelity, omit it entirely rather than output an altered, approximate, or invented version. A missing logo or UI is acceptable; a wrong one is not.",
            "Return the generated image only.",
          ].join("\n"),
        },
      ],
    },
    {
      role: "user" as const,
      content: userContent,
    },
  ];
};

// Composite the real OP logo PNG onto the generated image so the brand mark is
// always pixel perfect (the model is instructed not to draw one). Returns the
// composited image as base64 JPEG, or null if compositing is not possible — the
// caller then falls back to the original generated image.
const compositeBrandLogo = async (
  imageBase64: string,
  corner: LogoCorner,
): Promise<
  { imageData: string; mimeType: string; fileExtension: string } | null
> => {
  if (!fs.existsSync(opsUiLogoReferencePath)) {
    return null;
  }

  try {
    const inputBuffer = Buffer.from(imageBase64, "base64");
    const { width, height } = await sharp(inputBuffer).metadata();

    if (!width || !height) {
      return null;
    }

    const logoSize = Math.round(width * 0.14);
    const padding = Math.round(width * 0.045);
    const logoBuffer = await sharp(opsUiLogoReferencePath)
      .resize(logoSize, logoSize, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    const top = corner.startsWith("top") ? padding : height - logoSize - padding;
    const left = corner.endsWith("left") ? padding : width - logoSize - padding;
    const composited = await sharp(inputBuffer)
      .composite([{ input: logoBuffer, top, left }])
      .jpeg({ quality: 92 })
      .toBuffer();

    return {
      imageData: composited.toString("base64"),
      mimeType: "image/jpeg",
      fileExtension: "jpg",
    };
  } catch {
    return null;
  }
};

const generatePostImageViaResponses = async (
  prompt: string,
  styleConfig: ImageStyleConfig,
) => {
  if (!openai) {
    throw new Error("OpenAI is not configured.");
  }

  const response = await openai.responses.create({
    model: env.openAiImageReasoningModel,
    input: buildResponsesImageInput(prompt, styleConfig.includeUiReferences),
    tools: [
      {
        type: "image_generation",
        model: env.openAiImageModel,
        size: styleConfig.size,
        quality: "high",
        output_format: "jpeg",
        ...(supportsInputFidelity(env.openAiImageModel)
          ? { input_fidelity: "high" as const }
          : {}),
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
    mimeType: "image/jpeg",
    fileExtension: "jpg",
  };
};

const generatePostImageWithFallback = async (
  prompt: string,
  styleConfig: ImageStyleConfig,
) => {
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
    return await generatePostImageViaResponses(prompt, styleConfig);
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
          size: styleConfig.dalleSize,
          quality: "hd",
          response_format: "b64_json",
          style: "vivid",
        });
      } else {
        response = await openai?.images.generate({
          model,
          prompt,
          n: 1,
          size: styleConfig.size,
          quality: "high",
          output_format: "jpeg",
        });
      }
      const imageData = await getGeneratedImageData(response);

      return {
        imageData,
        model,
        mimeType: imageModelMimeType(model),
        fileExtension: imageModelFileExtension(model),
      };
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

      if (!request.user) {
        return reply.unauthorized("Missing authenticated user");
      }

      const input = aiPostImageRequestSchema.parse(request.body);
      const tags = normalizeTags(input.tags);
      const conversationId =
        input.conversationId?.trim() || `post-image-${request.user.id}`;
      const recentGenerations = await storage.listRecentAiPostImageGenerations(
        conversationId,
        request.user.id,
        6,
      );
      const appContext = await fetchOpsUiAppContext();
      const styleConfig = imageStyleConfig[input.style];

      let generatedImage: Awaited<ReturnType<typeof generatePostImageWithFallback>>;

      try {
        generatedImage = await generatePostImageWithFallback(
          buildImagePrompt({
            prompt: input.prompt,
            caption: input.caption,
            tags,
            appContext,
            recentGenerations,
            style: input.style,
          }),
          styleConfig,
        );
      } catch (error) {
        app.log.error({ error }, "OpenAI post image generation failed");

        const message = error instanceof Error
          ? error.message
          : "OpenAI image generation failed.";

        return reply.status(502).send({
          message: `OpenAI image generation failed: ${message}`,
        });
      }
      // Paste the real OP logo onto the result so the brand mark is pixel
      // perfect; fall back to the raw generation if compositing is unavailable.
      const brandedImage =
        (await compositeBrandLogo(
          generatedImage.imageData,
          styleConfig.logoCorner,
        )) ?? generatedImage;

      const generatedAt = new Date().toISOString();
      const fileName = `opsui-post-${Date.now()}.${brandedImage.fileExtension}`;

      await storage.insertAiPostImageGeneration({
        id: nanoid(),
        conversation_id: conversationId,
        prompt: input.prompt,
        caption: input.caption ?? null,
        tags_json: JSON.stringify(tags),
        image_name: fileName,
        image_model: generatedImage.model,
        created_by_user_id: request.user.id,
        created_at: generatedAt,
      });

      return aiPostImageSchema.parse({
        imageDataUrl: `data:${brandedImage.mimeType};base64,${brandedImage.imageData}`,
        fileName,
        conversationId,
        tags,
        generatedAt,
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

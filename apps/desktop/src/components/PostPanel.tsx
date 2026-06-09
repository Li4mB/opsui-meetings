import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, PointerEvent } from "react";
import type {
  AiChatMessage,
  AiPostContent,
  AiPostHistoryItem,
  AiPostImageStyle,
  AiPostPlan,
  AutoPostAgentConfig,
  AutoPostAgentSlot,
  SocialAccount,
  ScheduledSocialPlatform,
  ScheduledSocialPost,
  ScheduledSocialPostStatus,
} from "@opsui/shared";
import opsLogo from "../assets/op.png";
import {
  ApiError,
  bulkReviewSocialPosts,
  connectSocialAccount,
  deleteSocialAccount,
  deleteScheduledSocialPost,
  duplicateScheduledPost,
  editScheduledPostCaption,
  generatePostContent,
  generatePostImage,
  getAutoPostAgentConfig,
  getPostHistory,
  getScheduledSocialPosts,
  getSocialAccounts,
  planNextPost,
  publishScheduledPostNow,
  publishSocialPosts,
  rescheduleSocialPost,
  reviewSocialPost,
  scheduledPostImageUrl,
  scheduleSocialPosts,
  sendStrategyChat,
  updateAutoPostAgentConfig,
} from "../lib/api";

type SocialPlatform = ScheduledSocialPlatform;

type SocialPostDraft = {
  platform: SocialPlatform;
  caption: string;
  customized: boolean;
  tweakInstruction: string;
  isTweaking: boolean;
};

type PostImage = {
  id: string;
  name: string;
  url: string;
  generated: boolean;
  objectUrl: boolean;
};

type SocialAccountForm = {
  displayName: string;
  accountId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

type CalendarDay = {
  key: string;
  date: Date;
  inCurrentMonth: boolean;
  events: ScheduledSocialPost[];
};

type Props = {
  authToken: string;
  canManageSocialAccounts: boolean;
};

type PlatformMeta = {
  id: SocialPlatform;
  label: string;
  shortLabel: string;
  captionLimit: number;
  previewMeta: string;
  styleHint: string;
};

const imageConversationStorageKey = "opsui.postImageConversationId";

const imageStyleStorageKey = "opsui.postImageStyle";

type ImageStyleOption = {
  id: AiPostImageStyle;
  label: string;
  hint: string;
};

const imageStyles = [
  {
    id: "realistic",
    label: "Realistic",
    hint: "Real OpsUI app UI from the product screenshots. Portrait WMS/ERP campaign asset.",
  },
  {
    id: "premium",
    label: "Premium poster",
    hint: "Square luxury enterprise LinkedIn poster — dark violet gradients, abstract operational geometry, no app UI.",
  },
] as const satisfies readonly ImageStyleOption[];

const isImageStyle = (value: string | null): value is AiPostImageStyle =>
  imageStyles.some((style) => style.id === value);

const getInitialImageStyle = (): AiPostImageStyle => {
  const existing = window.localStorage.getItem(imageStyleStorageKey);

  return isImageStyle(existing) ? existing : "realistic";
};

const createImageConversationId = () => `post-image-${crypto.randomUUID()}`;

const getInitialImageConversationId = () => {
  const existing = window.localStorage.getItem(imageConversationStorageKey);

  if (existing) {
    return existing;
  }

  const next = createImageConversationId();

  window.localStorage.setItem(imageConversationStorageKey, next);
  return next;
};

const socialPlatforms = [
  {
    id: "facebook",
    label: "Facebook",
    shortLabel: "FB",
    captionLimit: 4000,
    previewMeta: "Business page post",
    styleHint: "Clear, conversational, and discussion-led.",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    shortLabel: "IN",
    captionLimit: 3000,
    previewMeta: "Company page update",
    styleHint: "Authority-led, practical, and easy to skim.",
  },
  {
    id: "twitter",
    label: "X/Twitter",
    shortLabel: "X",
    captionLimit: 280,
    previewMeta: "Short-form post",
    styleHint: "Sharp hook, one idea, direct CTA.",
  },
  {
    id: "instagram",
    label: "Instagram",
    shortLabel: "IG",
    captionLimit: 2200,
    previewMeta: "Feed post",
    styleHint: "Visual-first, human, hashtag-aware.",
  },
] as const satisfies readonly PlatformMeta[];

const platformById = Object.fromEntries(
  socialPlatforms.map((platform) => [platform.id, platform]),
) as Record<SocialPlatform, PlatformMeta>;

// Platforms offered in the composer. Facebook and Instagram are hidden but
// their data and code paths are kept intact.
const visiblePlatformIds: SocialPlatform[] = ["twitter", "linkedin"];
const visibleSocialPlatforms = socialPlatforms.filter((platform) =>
  visiblePlatformIds.includes(platform.id),
);

const maxCaptionLength = 4000;

const defaultCaptionPrompt =
  "Create a post about why growing warehouses outgrow spreadsheets when stock accuracy, order flow, and dispatch control start becoming daily problems.";

const defaultImagePrompt =
  "Create a premium portrait social media image for OpsUI about warehouse visibility and operational control. Make it serious, modern, practical, and designed for Australian and New Zealand operational businesses.";

const fallbackHashtags = [
  "opsui",
  "warehousemanagement",
  "wms",
  "erp",
  "stockaccuracy",
  "operations",
  "distribution",
  "anzbusiness",
];

const calendarWeekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const buildImageId = (file: File) =>
  `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`;

const revokePostImage = (image: PostImage | null) => {
  if (image?.objectUrl) {
    URL.revokeObjectURL(image.url);
  }
};

const extractHashtags = (value: string) => {
  const words = value
    .toLowerCase()
    .match(/[a-z][a-z0-9]{3,}/g) ?? [];
  const stopWords = new Set([
    "about",
    "business",
    "create",
    "daily",
    "from",
    "growing",
    "into",
    "post",
    "social",
    "that",
    "their",
    "this",
    "when",
    "with",
  ]);

  return [
    ...fallbackHashtags,
    ...words.filter((word) => !stopWords.has(word)),
  ]
    .filter((tag, index, allTags) => allTags.indexOf(tag) === index)
    .slice(0, 14);
};

const wrapText = (value: string, maxLineLength: number) => {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];

  for (const word of words) {
    const lastLine = lines.at(-1);

    if (!lastLine || `${lastLine} ${word}`.length > maxLineLength) {
      lines.push(word);
    } else {
      lines[lines.length - 1] = `${lastLine} ${word}`;
    }
  }

  return lines.slice(0, 4);
};

const escapeSvgText = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const buildSvgDataUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const buildLocalPosterSvg = (prompt: string) => {
  const normalized = prompt.toLowerCase();
  const headline = normalized.includes("spreadsheet")
    ? "SPREADSHEETS DO NOT SCALE OPERATIONS"
    : normalized.includes("stock")
      ? "STOCK CONTROL NEEDS REAL VISIBILITY"
      : "MANUAL CHAOS NEEDS OPERATIONAL CONTROL";
  const subhead = normalized.includes("dispatch")
    ? "OpsUI helps teams see orders, stock, and dispatch flow before small misses become daily drag."
    : "OpsUI helps warehouse and ERP teams move from scattered workarounds to clearer control.";
  const headlineLines = wrapText(headline, 19);
  const subheadLines = wrapText(subhead, 42);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536" viewBox="0 0 1024 1536">`,
    `<defs>`,
    `<radialGradient id="goldGlow" cx="72%" cy="20%" r="62%"><stop offset="0%" stop-color="#d6ad2d" stop-opacity="0.32"/><stop offset="100%" stop-color="#d6ad2d" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="steelGlow" cx="18%" cy="82%" r="56%"><stop offset="0%" stop-color="#64748b" stop-opacity="0.24"/><stop offset="100%" stop-color="#64748b" stop-opacity="0"/></radialGradient>`,
    `<pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#ffffff" stroke-opacity="0.055"/></pattern>`,
    `</defs>`,
    `<rect width="1024" height="1536" fill="#080807"/>`,
    `<rect width="1024" height="1536" fill="url(#grid)" opacity="0.62"/>`,
    `<rect width="1024" height="1536" fill="url(#goldGlow)"/>`,
    `<rect width="1024" height="1536" fill="url(#steelGlow)"/>`,
    `<rect x="76" y="76" width="872" height="1384" rx="42" fill="#11100d" fill-opacity="0.86" stroke="#d6ad2d" stroke-opacity="0.24"/>`,
    `<text x="116" y="160" fill="#d6ad2d" font-family="Arial, sans-serif" font-size="27" font-weight="800" letter-spacing="7">OPSUI</text>`,
    ...headlineLines.map(
      (line, index) =>
        `<text x="116" y="${340 + index * 82}" fill="#fff6d8" font-family="Arial Black, Arial, sans-serif" font-size="66" font-weight="900">${escapeSvgText(line)}</text>`,
    ),
    ...subheadLines.map(
      (line, index) =>
        `<text x="122" y="${720 + index * 46}" fill="#d6d0c2" font-family="Arial, sans-serif" font-size="30" font-weight="500">${escapeSvgText(line)}</text>`,
    ),
    `<rect x="116" y="970" width="792" height="280" rx="28" fill="#171717" stroke="#ffffff" stroke-opacity="0.1"/>`,
    `<rect x="154" y="1026" width="280" height="36" rx="18" fill="#2f2f2a"/>`,
    `<rect x="154" y="1100" width="716" height="26" rx="13" fill="#d6ad2d" opacity="0.74"/>`,
    `<rect x="154" y="1164" width="574" height="22" rx="11" fill="#ffffff" opacity="0.14"/>`,
    `<rect x="154" y="1218" width="650" height="22" rx="11" fill="#ffffff" opacity="0.1"/>`,
    `<text x="116" y="1352" fill="#d6ad2d" font-family="Arial, sans-serif" font-size="25" font-weight="800">WAREHOUSE VISIBILITY. STOCK ACCURACY. CONTROL.</text>`,
    `</svg>`,
  ].join("");
};

const buildFallbackStrategy = (source: string): AiPostContent => {
  const hashtagBank = extractHashtags(source);
  const caption = [
    "If your warehouse needs a spreadsheet to explain what the system cannot show, the process is already under pressure.",
    "Growing teams need clear stock visibility, clean order flow, and dispatch control they can trust before the day gets away from them.",
    "OpsUI helps operational businesses move from manual chaos to clearer control and scalable execution.",
    "Where does your team still rely on manual workarounds?",
    hashtagBank.slice(0, 7).map((tag) => `#${tag}`).join(" "),
  ].join("\n\n");

  return {
    caption,
    alternatives: [
      "Warehouse growth usually exposes the same issue: the team can move faster than the system can explain what is happening.",
      "Stock accuracy is not just an inventory problem. It affects orders, dispatch, reporting, and every operational decision after that.",
      "Spreadsheets can help a small team survive. They rarely give a growing operation the control it needs.",
    ],
    hashtagBank,
    postingStyleRecommendation:
      "Lead with one practical operational pain point, keep the post direct, and invite a conversation instead of pushing for a sale.",
    ctaOptions: [
      "Where is your team still relying on manual workarounds?",
      "If this sounds familiar, it may be time to review the workflow.",
      "Worth a conversation if stock, orders, or dispatch are getting harder to control.",
    ],
    generatedAt: new Date().toISOString(),
    model: "local-fallback",
  };
};

// Drafts are keyed by account id. A draft only needs to exist once a target
// account is customised or tweaked; otherwise the card falls back to the master
// caption.
const createDraft = (
  platform: SocialPlatform,
  caption: string,
): SocialPostDraft => ({
  platform,
  caption,
  customized: false,
  tweakInstruction: "",
  isTweaking: false,
});

const getUserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Local timezone";
  } catch {
    return "Local timezone";
  }
};

const padDatePart = (value: number) => value.toString().padStart(2, "0");

const formatDateTimeLocalValue = (date: Date) =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;

const formatTimeInputValue = (date: Date) =>
  `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;

const createSocialAccountForm = (
  platform: SocialPlatform,
  account?: SocialAccount,
): SocialAccountForm => ({
  displayName: account?.displayName ?? platformById[platform].label,
  accountId: account?.accountId ?? "",
  accessToken: "",
  refreshToken: "",
  expiresAt: account?.expiresAt
    ? formatDateTimeLocalValue(new Date(account.expiresAt))
    : "",
});

const buildDefaultScheduleValue = () => {
  const date = new Date();

  date.setHours(date.getHours() + 1, 0, 0, 0);
  return formatDateTimeLocalValue(date);
};

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Uploaded image could not be read."));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("Uploaded image could not be read."));
    reader.readAsDataURL(file);
  });

const buildCalendarImageThumbnail = (source: string) =>
  new Promise<string | null>((resolve) => {
    const image = new Image();
    const fallback = source.length < 500_000 ? source : null;

    image.onload = () => {
      const maxSize = 220;
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) {
        resolve(fallback);
        return;
      }

      canvas.width = width;
      canvas.height = height;
      context.drawImage(image, 0, 0, width, height);

      try {
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      } catch {
        resolve(fallback);
      }
    };

    image.onerror = () => resolve(fallback);
    image.src = source;
  });

const compareScheduledPosts = (left: ScheduledSocialPost, right: ScheduledSocialPost) =>
  new Date(left.scheduledFor).getTime() - new Date(right.scheduledFor).getTime();

const formatWithTimezone = (
  isoDate: string,
  options: Intl.DateTimeFormatOptions,
  timezone: string,
) => {
  const date = new Date(isoDate);

  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      ...options,
      ...(timezone !== "Local timezone" ? { timeZone: timezone } : {}),
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }
};

const formatScheduledDateTime = (isoDate: string, timezone: string) =>
  formatWithTimezone(
    isoDate,
    {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
    timezone,
  );

const formatScheduledTime = (isoDate: string, timezone: string) =>
  formatWithTimezone(
    isoDate,
    {
      hour: "numeric",
      minute: "2-digit",
    },
    timezone,
  );

const getLocalDateKey = (date: Date) =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;

const canEditScheduledPost = (post: ScheduledSocialPost) =>
  ["scheduled", "failed", "connection_required", "pending_review"].includes(post.status);

const mergeDateWithPostTime = (date: Date, post: ScheduledSocialPost) => {
  const current = new Date(post.scheduledFor);
  const next = new Date(date);

  next.setHours(current.getHours(), current.getMinutes(), 0, 0);
  return next;
};

const mergePostDateWithTime = (post: ScheduledSocialPost, time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  const next = new Date(post.scheduledFor);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return next;
  }

  next.setHours(hours, minutes, 0, 0);
  return next;
};

const isInteractiveScheduledPostTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(target.closest("button, input, textarea, select, a"));

const buildCalendarDays = (
  monthDate: Date,
  scheduledPosts: ScheduledSocialPost[],
): CalendarDay[] => {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const startDate = new Date(firstDay);
  const postsByDate = new Map<string, ScheduledSocialPost[]>();

  startDate.setDate(firstDay.getDate() - firstDay.getDay());

  for (const post of scheduledPosts) {
    const key = getLocalDateKey(new Date(post.scheduledFor));
    const events = postsByDate.get(key) ?? [];

    events.push(post);
    postsByDate.set(key, events);
  }

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate);

    date.setDate(startDate.getDate() + index);

    return {
      key: getLocalDateKey(date),
      date,
      inCurrentMonth: date.getMonth() === monthDate.getMonth(),
      events: postsByDate.get(getLocalDateKey(date)) ?? [],
    };
  });
};

export const PostPanel = ({ authToken, canManageSocialAccounts }: Props) => {
  const [captionPrompt, setCaptionPrompt] = useState(defaultCaptionPrompt);
  const [imagePrompt, setImagePrompt] = useState(defaultImagePrompt);
  const [masterCaption, setMasterCaption] = useState("");
  const [captionStrategy, setCaptionStrategy] = useState<AiPostContent | null>(null);
  const [postImage, setPostImage] = useState<PostImage | null>(null);
  const [imageConversationId, setImageConversationId] = useState(
    getInitialImageConversationId,
  );
  const [imageStyle, setImageStyle] = useState<AiPostImageStyle>(
    getInitialImageStyle,
  );
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, SocialPostDraft>>({});
  const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isSchedulingPost, setIsSchedulingPost] = useState(false);
  const [isPublishingPost, setIsPublishingPost] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [scheduleAt, setScheduleAt] = useState(buildDefaultScheduleValue);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledSocialPost[]>([]);
  const [isScheduledQueueLoading, setIsScheduledQueueLoading] = useState(false);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
  const [isSocialAccountsLoading, setIsSocialAccountsLoading] = useState(false);
  const [connectPlatform, setConnectPlatform] = useState<SocialPlatform | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState<SocialAccountForm>(() =>
    createSocialAccountForm("twitter"),
  );
  const [isSavingSocialAccount, setIsSavingSocialAccount] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [showScheduledQueue, setShowScheduledQueue] = useState(false);
  const [queueMonth, setQueueMonth] = useState(() => new Date());
  const [draggedScheduledPostId, setDraggedScheduledPostId] = useState<string | null>(null);
  const [scheduledDragPoint, setScheduledDragPoint] = useState<{ x: number; y: number } | null>(null);
  const [updatingScheduledPostIds, setUpdatingScheduledPostIds] = useState<string[]>([]);
  // Schedule-queue revamp: view, filters, detail panel, bulk select
  const [queueViewMode, setQueueViewMode] = useState<"calendar" | "agenda">("calendar");
  const [queueFilters, setQueueFilters] = useState<{
    platform: SocialPlatform | "all";
    accountId: string | "all";
    status: ScheduledSocialPostStatus | "all";
  }>({ platform: "all", accountId: "all", status: "all" });
  const [selectedQueuePostId, setSelectedQueuePostId] = useState<string | null>(null);
  const [detailCaptionDraft, setDetailCaptionDraft] = useState("");
  const [isSavingCaption, setIsSavingCaption] = useState(false);
  const [selectedReviewIds, setSelectedReviewIds] = useState<string[]>([]);
  const [isBulkBusy, setIsBulkBusy] = useState(false);
  // History / planner / assistant / auto-post agent
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<AiPostHistoryItem[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<{
    kind: "all" | "posts" | "generations";
    accountId: string | "all";
  }>({ kind: "all", accountId: "all" });
  const [isPlanning, setIsPlanning] = useState(false);
  const [planRationale, setPlanRationale] = useState<AiPostPlan | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<AiChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatSending, setIsChatSending] = useState(false);
  const [agentConfig, setAgentConfig] = useState<AutoPostAgentConfig | null>(null);
  const [isAgentExpanded, setIsAgentExpanded] = useState(false);
  const [isSavingAgent, setIsSavingAgent] = useState(false);
  const masterCaptionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const postImageRef = useRef<PostImage | null>(null);
  const agentSaveSeqRef = useRef(0);
  const userTimezone = useMemo(getUserTimezone, []);

  const previewTime = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date()),
    [],
  );
  const activeHashtags = captionStrategy?.hashtagBank.length
    ? captionStrategy.hashtagBank
    : fallbackHashtags;
  const hasImage = Boolean(postImage);
  const readyToPreview = masterCaption.trim().length > 0 || hasImage;
  const minimumScheduleAt = useMemo(() => formatDateTimeLocalValue(new Date()), []);
  const sortedScheduledPosts = useMemo(
    () => [...scheduledPosts].sort(compareScheduledPosts),
    [scheduledPosts],
  );
  const filteredScheduledPosts = useMemo(
    () =>
      sortedScheduledPosts.filter(
        (post) =>
          (queueFilters.platform === "all" || post.platform === queueFilters.platform) &&
          (queueFilters.accountId === "all" || post.accountId === queueFilters.accountId) &&
          (queueFilters.status === "all" || post.status === queueFilters.status),
      ),
    [sortedScheduledPosts, queueFilters],
  );
  const calendarDays = useMemo(
    () => buildCalendarDays(queueMonth, filteredScheduledPosts),
    [queueMonth, filteredScheduledPosts],
  );
  const agendaGroups = useMemo(() => {
    const groups = new Map<string, ScheduledSocialPost[]>();
    for (const post of filteredScheduledPosts) {
      const key = getLocalDateKey(new Date(post.scheduledFor));
      const list = groups.get(key) ?? [];
      list.push(post);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [filteredScheduledPosts]);
  const selectedQueuePost = useMemo(
    () => scheduledPosts.find((post) => post.id === selectedQueuePostId) ?? null,
    [scheduledPosts, selectedQueuePostId],
  );
  const pendingReviewVisible = useMemo(
    () => filteredScheduledPosts.filter((post) => post.status === "pending_review"),
    [filteredScheduledPosts],
  );
  const draggedScheduledPost = useMemo(
    () =>
      draggedScheduledPostId
        ? scheduledPosts.find((post) => post.id === draggedScheduledPostId) ?? null
        : null,
    [draggedScheduledPostId, scheduledPosts],
  );
  const accountById = useMemo(
    () =>
      Object.fromEntries(
        socialAccounts.map((account) => [account.id, account]),
      ) as Record<string, SocialAccount>,
    [socialAccounts],
  );
  // Accounts shown in the account list, grouped by visible platform.
  const accountsByVisiblePlatform = useMemo(
    () =>
      Object.fromEntries(
        visiblePlatformIds.map((platform) => [
          platform,
          socialAccounts.filter((account) => account.platform === platform),
        ]),
      ) as Record<SocialPlatform, SocialAccount[]>,
    [socialAccounts],
  );
  // Connected accounts on visible platforms are the selectable posting targets.
  const connectedAccounts = useMemo(
    () =>
      socialAccounts.filter(
        (account) =>
          account.connected && visiblePlatformIds.includes(account.platform),
      ),
    [socialAccounts],
  );
  const connectedAccountCount = connectedAccounts.length;
  const selectedAll =
    connectedAccounts.length > 0 &&
    selectedAccountIds.length === connectedAccounts.length;
  const pendingReviewPosts = useMemo(
    () => scheduledPosts.filter((post) => post.status === "pending_review"),
    [scheduledPosts],
  );
  // Distinct connected accounts that appear in the history (for the chips).
  const historyAccounts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of historyItems) {
      if (item.accountId && !seen.has(item.accountId)) {
        seen.set(item.accountId, item.accountLabel ?? item.platform ?? item.accountId);
      }
    }
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }, [historyItems]);
  const filteredHistoryItems = useMemo(
    () =>
      historyItems.filter(
        (item) =>
          (historyFilter.kind === "all" ||
            (historyFilter.kind === "posts" && item.kind === "published") ||
            (historyFilter.kind === "generations" && item.kind !== "published")) &&
          (historyFilter.accountId === "all" || item.accountId === historyFilter.accountId),
      ),
    [historyItems, historyFilter],
  );
  // Group history by account (published) / "Caption drafts" (generations).
  const historyGroups = useMemo(() => {
    const groups = new Map<string, AiPostHistoryItem[]>();
    for (const item of filteredHistoryItems) {
      const label =
        item.kind === "published"
          ? item.accountLabel ?? item.platform ?? "Posts"
          : "Caption drafts";
      const list = groups.get(label) ?? [];
      list.push(item);
      groups.set(label, list);
    }
    return [...groups.entries()];
  }, [filteredHistoryItems]);
  const queueMonthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: "long",
        year: "numeric",
      }).format(queueMonth),
    [queueMonth],
  );

  useEffect(() => {
    postImageRef.current = postImage;
  }, [postImage]);

  useEffect(() => {
    return () => {
      revokePostImage(postImageRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadScheduledPosts = async () => {
      setIsScheduledQueueLoading(true);

      try {
        const response = await getScheduledSocialPosts(authToken);

        if (!cancelled) {
          setScheduledPosts(response.posts);
        }
      } catch {
        if (!cancelled) {
          setSaveNotice("Unable to load the shared posting queue.");
        }
      } finally {
        if (!cancelled) {
          setIsScheduledQueueLoading(false);
        }
      }
    };

    void loadScheduledPosts();
    const interval = window.setInterval(() => void loadScheduledPosts(), 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [authToken]);

  // Clear any bulk-review selection when the filters change or the queue closes,
  // so a stale selection can't act on posts the user can no longer see.
  useEffect(() => {
    setSelectedReviewIds([]);
  }, [queueFilters, showScheduledQueue]);

  useEffect(() => {
    let cancelled = false;

    getAutoPostAgentConfig(authToken)
      .then((response) => {
        if (!cancelled) {
          setAgentConfig(response.config);
        }
      })
      .catch(() => {
        /* agent config is optional; ignore load errors */
      });

    return () => {
      cancelled = true;
    };
  }, [authToken]);

  useEffect(() => {
    let cancelled = false;

    const loadSocialAccounts = async () => {
      setIsSocialAccountsLoading(true);

      try {
        const response = await getSocialAccounts(authToken);

        if (!cancelled) {
          setSocialAccounts(response.accounts);
        }
      } catch {
        if (!cancelled) {
          setSaveNotice("Unable to load connected social accounts.");
        }
      } finally {
        if (!cancelled) {
          setIsSocialAccountsLoading(false);
        }
      }
    };

    void loadSocialAccounts();

    return () => {
      cancelled = true;
    };
  }, [authToken]);

  useEffect(() => {
    if (!saveNotice) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setSaveNotice(null), 3600);

    return () => window.clearTimeout(timeout);
  }, [saveNotice]);

  useEffect(() => {
    const input = masterCaptionInputRef.current;

    if (!input) {
      return;
    }

    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }, [masterCaption]);

  useEffect(() => {
    if (!isScheduleModalOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsScheduleModalOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isScheduleModalOpen]);

  useEffect(() => {
    const handleOpenPostCalendar = () => setShowScheduledQueue(true);

    window.addEventListener("opsui:open-post-calendar", handleOpenPostCalendar);
    return () => window.removeEventListener("opsui:open-post-calendar", handleOpenPostCalendar);
  }, []);

  const replaceImage = (image: PostImage | null) => {
    setPostImage((current) => {
      revokePostImage(current);
      return image;
    });
  };

  // A customised per-account draft keeps its own caption; otherwise the card
  // falls back to the live master caption.
  const getDraftCaption = (accountId: string) => {
    const draft = drafts[accountId];
    return draft?.customized ? draft.caption : masterCaption;
  };

  const applyCaptionStrategy = (strategy: AiPostContent, notice: string) => {
    setCaptionStrategy(strategy);
    setMasterCaption(strategy.caption);
    setDrafts({});
    setSaveNotice(notice);
  };

  const handleMasterCaptionChange = (caption: string) => {
    setMasterCaption(caption);
  };

  const openSocialAccountDialog = (
    platform: SocialPlatform,
    account?: SocialAccount,
  ) => {
    setConnectPlatform(platform);
    setEditingAccountId(account?.id ?? null);
    setAccountForm(createSocialAccountForm(platform, account));
  };

  const closeSocialAccountDialog = () => {
    setConnectPlatform(null);
    setEditingAccountId(null);
    setAccountForm(createSocialAccountForm("twitter"));
  };

  const handleSaveSocialAccount = async () => {
    if (!connectPlatform) {
      return;
    }

    if (!canManageSocialAccounts) {
      setSaveNotice("Admin access is required to connect social accounts.");
      return;
    }

    const displayName = accountForm.displayName.trim() || platformById[connectPlatform].label;
    const accountId = accountForm.accountId.trim() || displayName;
    const accessToken = accountForm.accessToken.trim();

    if (!accessToken) {
      setSaveNotice("Paste the platform access token before saving.");
      return;
    }

    const refreshToken = accountForm.refreshToken.trim();

    setIsSavingSocialAccount(true);

    try {
      const response = await connectSocialAccount(authToken, {
        ...(editingAccountId ? { id: editingAccountId } : {}),
        platform: connectPlatform,
        displayName,
        accountId,
        accessToken,
        // undefined keeps any existing refresh token when editing.
        refreshToken: refreshToken || undefined,
        expiresAt: accountForm.expiresAt
          ? new Date(accountForm.expiresAt).toISOString()
          : null,
      });

      setSocialAccounts(response.accounts);
      setSaveNotice(
        `${displayName} ${editingAccountId ? "updated" : "connected"}.`,
      );
      closeSocialAccountDialog();
    } catch (error) {
      setSaveNotice(
        error instanceof ApiError
          ? error.message
          : `Unable to connect ${platformById[connectPlatform].label}.`,
      );
    } finally {
      setIsSavingSocialAccount(false);
    }
  };

  const handleDisconnectSocialAccount = async (account: SocialAccount) => {
    if (account.source === "environment") {
      setSaveNotice("This account is managed by API environment variables.");
      return;
    }

    if (!window.confirm(`Disconnect ${account.displayName}?`)) {
      return;
    }

    try {
      const response = await deleteSocialAccount(authToken, account.id);

      setSocialAccounts(response.accounts);
      setSelectedAccountIds((current) =>
        current.filter((id) => id !== account.id),
      );
      setSaveNotice(`${account.displayName} disconnected.`);
    } catch (error) {
      const reason =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "unknown error";
      setSaveNotice(`Couldn't disconnect ${account.displayName}: ${reason}`);
    }
  };

  const handleGenerateCaption = async () => {
    const source = captionPrompt.trim() || masterCaption.trim();

    if (!source) {
      setSaveNotice("Add a caption prompt first.");
      return;
    }

    setIsGeneratingCaption(true);

    try {
      const generated = await generatePostContent(authToken, {
        prompt: source,
        platform: "general",
        currentCaption: masterCaption,
        imageNames: postImage ? [postImage.name] : [],
        tags: activeHashtags,
      });

      applyCaptionStrategy(generated, "Caption strategy generated.");
    } catch (error) {
      applyCaptionStrategy(
        buildFallbackStrategy(source),
        error instanceof ApiError
          ? `AI caption failed: ${error.message}. Used local fallback.`
          : "AI caption unavailable. Used local fallback.",
      );
    } finally {
      setIsGeneratingCaption(false);
    }
  };

  const handleResetImageMemory = () => {
    const next = createImageConversationId();

    window.localStorage.setItem(imageConversationStorageKey, next);
    setImageConversationId(next);
    setSaveNotice("Image generation memory reset.");
  };

  const handleSelectImageStyle = (style: AiPostImageStyle) => {
    setImageStyle(style);
    window.localStorage.setItem(imageStyleStorageKey, style);
  };

  // Map a planner result onto the composer. Shared by the "Plan" button and the
  // assistant's "draft this as a post" handoff. The image still routes through
  // the hardlocked generatePostImage path — the plan only sets prompt + style.
  const applyPlan = (plan: AiPostPlan) => {
    applyCaptionStrategy(
      {
        caption: plan.caption,
        alternatives: plan.alternatives,
        hashtagBank: plan.hashtagBank,
        postingStyleRecommendation: plan.rationale,
        ctaOptions: plan.ctaOptions,
        generatedAt: plan.generatedAt,
        model: plan.model,
      },
      "Planner prefilled the composer — review and generate the image.",
    );
    setCaptionPrompt(plan.angle);
    setImagePrompt(plan.imagePrompt);
    handleSelectImageStyle(plan.imageStyle);

    const ids = plan.recommendedAccounts
      .map((target) => target.accountId)
      .filter((id) => accountById[id]?.connected);
    setSelectedAccountIds(ids);
    plan.recommendedAccounts.forEach((target) => {
      if (target.captionTweak && accountById[target.accountId]?.connected) {
        updateDraft(target.accountId, {
          caption: target.captionTweak,
          customized: true,
        });
      }
    });

    if (plan.suggestedPostTime.isoTime) {
      const when = new Date(plan.suggestedPostTime.isoTime);
      if (!Number.isNaN(when.getTime()) && when.getTime() > Date.now()) {
        setScheduleAt(formatDateTimeLocalValue(when));
      }
    }

    setPlanRationale(plan);
  };

  const handlePlanNextPost = async () => {
    if (!connectedAccounts.length) {
      setSaveNotice("Connect an account before planning a post.");
      return;
    }

    setIsPlanning(true);

    try {
      const plan = await planNextPost(authToken, {
        targetAccountIds: selectedAccountIds,
        timezone: userTimezone,
        nowIso: new Date().toISOString(),
      });
      applyPlan(plan);
    } catch (error) {
      setSaveNotice(
        error instanceof ApiError
          ? `Planner failed: ${error.message}`
          : "Planner unavailable.",
      );
    } finally {
      setIsPlanning(false);
    }
  };

  const handleOpenHistory = async () => {
    setIsHistoryOpen(true);
    setIsHistoryLoading(true);

    try {
      const response = await getPostHistory(authToken);
      setHistoryItems(response.items);
    } catch {
      setHistoryItems([]);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const handleReuseHistory = (item: AiPostHistoryItem) => {
    if (item.caption) {
      setMasterCaption(item.caption);
    }
    if (item.prompt) {
      setCaptionPrompt(item.prompt);
    }
    setIsHistoryOpen(false);
    setSaveNotice("Loaded from history.");
  };

  const handleUseAsBasis = async (item: AiPostHistoryItem) => {
    const basis = item.caption ?? item.prompt;
    if (!basis) {
      return;
    }
    if (!connectedAccounts.length) {
      setSaveNotice("Connect an account before planning a post.");
      return;
    }

    setIsHistoryOpen(false);
    setIsPlanning(true);
    try {
      const plan = await planNextPost(authToken, {
        targetAccountIds: selectedAccountIds,
        guidance: `Use this past OpsUI post as the basis — produce a fresh, non-duplicate variation in the same spirit: ${basis}`,
        timezone: userTimezone,
        nowIso: new Date().toISOString(),
      });
      applyPlan(plan);
      setSaveNotice("Drafted a new post based on that one.");
    } catch (error) {
      setSaveNotice(
        error instanceof ApiError ? `Planner failed: ${error.message}` : "Planner unavailable.",
      );
    } finally {
      setIsPlanning(false);
    }
  };

  const handleSendChat = async () => {
    const text = chatInput.trim();

    if (!text || isChatSending) {
      return;
    }

    const nextMessages: AiChatMessage[] = [
      ...chatMessages,
      { role: "user", content: text },
    ];
    setChatMessages(nextMessages);
    setChatInput("");
    setIsChatSending(true);

    try {
      const response = await sendStrategyChat(authToken, {
        messages: nextMessages,
      });
      setChatMessages((current) => [
        ...current,
        { role: "assistant", content: response.reply },
      ]);

      if (response.handoff.action === "draft_post") {
        const plan = await planNextPost(authToken, {
          targetAccountIds: selectedAccountIds,
          guidance: response.handoff.seedGuidance ?? undefined,
          timezone: userTimezone,
          nowIso: new Date().toISOString(),
        });
        applyPlan(plan);
        setIsChatOpen(false);
        setSaveNotice("Assistant drafted a post into the composer.");
      }
    } catch (error) {
      setChatMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            error instanceof ApiError
              ? `(error) ${error.message}`
              : "(error) Assistant unavailable.",
        },
      ]);
    } finally {
      setIsChatSending(false);
    }
  };

  const saveAgentConfig = async (next: AutoPostAgentConfig) => {
    // Sequence guard: rapid edits issue overlapping POSTs; only the most recent
    // one is allowed to commit its server response so an out-of-order reply
    // can't revert a newer edit.
    const seq = (agentSaveSeqRef.current += 1);
    setAgentConfig(next);
    setIsSavingAgent(true);

    try {
      const response = await updateAutoPostAgentConfig(authToken, {
        enabled: next.enabled,
        cadence: next.cadence,
        imageStyle: next.imageStyle,
        timezone: next.timezone,
      });
      if (agentSaveSeqRef.current === seq) {
        setAgentConfig(response.config);
      }
    } catch (error) {
      setSaveNotice(
        error instanceof ApiError
          ? `Agent save failed: ${error.message}`
          : "Could not save agent settings.",
      );
      try {
        const reverted = await getAutoPostAgentConfig(authToken);
        if (agentSaveSeqRef.current === seq) {
          setAgentConfig(reverted.config);
        }
      } catch {
        /* keep optimistic value if reload also fails */
      }
    } finally {
      if (agentSaveSeqRef.current === seq) {
        setIsSavingAgent(false);
      }
    }
  };

  const handleReviewPost = async (
    post: ScheduledSocialPost,
    action: "approve" | "reject",
    publishNow = false,
  ) => {
    setScheduledPostUpdating(post.id, true);

    try {
      const response = await reviewSocialPost(authToken, post.id, {
        action,
        ...(action === "approve"
          ? {
              publishNow,
              scheduledFor: post.scheduledFor,
              timezone: post.timezone,
            }
          : {}),
      });
      setScheduledPosts(response.posts);
      setSaveNotice(
        action === "reject"
          ? "Draft rejected."
          : publishNow
            ? "Draft published."
            : "Draft approved and scheduled.",
      );
    } catch (error) {
      setSaveNotice(
        error instanceof ApiError ? `Review failed: ${error.message}` : "Review failed.",
      );
    } finally {
      setScheduledPostUpdating(post.id, false);
    }
  };

  const handleSaveDetailCaption = async (post: ScheduledSocialPost) => {
    setIsSavingCaption(true);
    try {
      const response = await editScheduledPostCaption(authToken, post.id, {
        caption: detailCaptionDraft,
      });
      setScheduledPosts(response.posts);
      setSaveNotice("Caption updated.");
    } catch (error) {
      setSaveNotice(
        error instanceof ApiError ? `Caption save failed: ${error.message}` : "Caption save failed.",
      );
    } finally {
      setIsSavingCaption(false);
    }
  };

  const handlePublishNow = async (post: ScheduledSocialPost) => {
    setScheduledPostUpdating(post.id, true);
    try {
      // pending_review drafts publish through the review-approve path.
      const response =
        post.status === "pending_review"
          ? await reviewSocialPost(authToken, post.id, {
              action: "approve",
              publishNow: true,
              scheduledFor: post.scheduledFor,
              timezone: post.timezone,
            })
          : await publishScheduledPostNow(authToken, post.id);
      setScheduledPosts(response.posts);
      setSaveNotice("Publishing now.");
    } catch (error) {
      setSaveNotice(
        error instanceof ApiError ? `Publish failed: ${error.message}` : "Publish failed.",
      );
    } finally {
      setScheduledPostUpdating(post.id, false);
    }
  };

  const handleDuplicatePost = async (post: ScheduledSocialPost) => {
    setScheduledPostUpdating(post.id, true);
    try {
      // Clone to tomorrow at the same time; the user can drag/reschedule after.
      const next = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const response = await duplicateScheduledPost(authToken, post.id, {
        scheduledFor: next.toISOString(),
        timezone: userTimezone,
      });
      setScheduledPosts(response.posts);
      setSaveNotice("Post duplicated into the queue.");
    } catch (error) {
      setSaveNotice(
        error instanceof ApiError ? `Duplicate failed: ${error.message}` : "Duplicate failed.",
      );
    } finally {
      setScheduledPostUpdating(post.id, false);
    }
  };

  const handleBulkReview = async (action: "approve" | "reject") => {
    // Only act on drafts that are actually visible under the current filters, so
    // a stale selection can't silently approve/reject hidden posts.
    const ids = selectedReviewIds.filter((id) =>
      pendingReviewVisible.some((post) => post.id === id),
    );
    if (!ids.length) {
      setSelectedReviewIds([]);
      return;
    }
    setIsBulkBusy(true);
    try {
      const response = await bulkReviewSocialPosts(authToken, { ids, action });
      setScheduledPosts(response.posts);
      setSelectedReviewIds([]);
      setSaveNotice(
        action === "approve" ? "Selected drafts approved." : "Selected drafts rejected.",
      );
    } catch (error) {
      setSaveNotice(
        error instanceof ApiError ? `Bulk review failed: ${error.message}` : "Bulk review failed.",
      );
    } finally {
      setIsBulkBusy(false);
    }
  };

  const toggleReviewSelection = (id: string) =>
    setSelectedReviewIds((ids) =>
      ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
    );

  const openQueueDetail = (post: ScheduledSocialPost) => {
    setSelectedQueuePostId(post.id);
    setDetailCaptionDraft(post.caption);
  };

  // Shared event card for both the calendar grid and the agenda list.
  const renderQueueEvent = (event: ScheduledSocialPost) => {
    const meta = platformById[event.platform];
    const isUpdating = updatingScheduledPostIds.includes(event.id);
    const accountLabel = event.accountId ? accountById[event.accountId]?.displayName : null;

    return (
      <article
        className={[
          "post-calendar-event",
          canEditScheduledPost(event) ? "post-calendar-event--editable" : "",
          isUpdating ? "post-calendar-event--updating" : "",
          selectedQueuePostId === event.id ? "post-calendar-event--selected" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-grabbed={draggedScheduledPostId === event.id}
        draggable={canEditScheduledPost(event)}
        onDragEnd={() => setDraggedScheduledPostId(null)}
        onDragStart={(dragEvent) => handleScheduledPostDragStart(dragEvent, event)}
        onPointerDown={(pointerEvent) => handleScheduledPostPointerDown(pointerEvent, event)}
        onClick={(clickEvent) => {
          if (isInteractiveScheduledPostTarget(clickEvent.target)) {
            return;
          }
          openQueueDetail(event);
        }}
        key={event.id}
        title={`${meta.label} at ${formatScheduledTime(event.scheduledFor, event.timezone)} - ${event.statusMessage ?? event.status}`}
      >
        {event.status === "pending_review" ? (
          <input
            aria-label="Select draft for bulk review"
            checked={selectedReviewIds.includes(event.id)}
            className="post-calendar-event__check"
            onChange={() => toggleReviewSelection(event.id)}
            type="checkbox"
          />
        ) : null}
        {event.thumbnailDataUrl ? (
          <img
            alt={event.imageName ?? `${meta.label} scheduled image`}
            draggable={false}
            src={event.thumbnailDataUrl}
          />
        ) : (
          <span className="post-calendar-event__placeholder">{meta.shortLabel}</span>
        )}
        <div className="post-calendar-event__details">
          <span>
            {meta.label}
            {accountLabel ? ` · ${accountLabel}` : ""}
          </span>
          <strong>{formatScheduledTime(event.scheduledFor, event.timezone)}</strong>
          <small>{event.status.replace(/_/g, " ")}</small>
          {(event.status === "failed" || event.status === "connection_required") &&
          event.statusMessage ? (
            <small className="post-calendar-event__error">{event.statusMessage}</small>
          ) : null}
        </div>
        <div className="post-calendar-event__controls">
          <input
            aria-label={`Move ${meta.label} post time`}
            disabled={!canEditScheduledPost(event) || isUpdating}
            onChange={(changeEvent) => {
              const nextDate = mergePostDateWithTime(event, changeEvent.target.value);
              if (!Number.isNaN(nextDate.getTime())) {
                void handleReschedulePost(event, nextDate);
              }
            }}
            type="time"
            value={formatTimeInputValue(new Date(event.scheduledFor))}
          />
          {event.status === "pending_review" ? (
            <button
              className="post-calendar-event__approve"
              disabled={isUpdating}
              onClick={() => void handleReviewPost(event, "approve")}
              type="button"
            >
              Approve
            </button>
          ) : null}
          <button
            disabled={!canEditScheduledPost(event) || isUpdating}
            onClick={() =>
              void (event.status === "pending_review"
                ? handleReviewPost(event, "reject")
                : handleRemoveScheduledPost(event))
            }
            type="button"
          >
            {event.status === "pending_review" ? "Reject" : "Remove"}
          </button>
        </div>
      </article>
    );
  };

  const handleGenerateImage = async () => {
    const source = imagePrompt.trim() || captionPrompt.trim() || masterCaption.trim();

    if (!source) {
      setSaveNotice("Add an image prompt first.");
      return;
    }

    setIsGeneratingImage(true);

    try {
      const generated = await generatePostImage(authToken, {
        prompt: source,
        caption: masterCaption,
        tags: activeHashtags,
        conversationId: imageConversationId,
        style: imageStyle,
      });

      setImageConversationId(generated.conversationId);
      window.localStorage.setItem(
        imageConversationStorageKey,
        generated.conversationId,
      );
      replaceImage({
        id: `generated-${Date.now()}-${crypto.randomUUID()}`,
        name: generated.fileName,
        url: generated.imageDataUrl,
        generated: true,
        objectUrl: false,
      });
      setSaveNotice(`Image generated with ${generated.model}. OpsUI reference memory applied.`);
    } catch (error) {
      const svg = buildLocalPosterSvg(source);

      replaceImage({
        id: `fallback-${Date.now()}-${crypto.randomUUID()}`,
        name: "opsui-social-fallback.svg",
        url: buildSvgDataUrl(svg),
        generated: true,
        objectUrl: false,
      });
      setSaveNotice(
        error instanceof ApiError
          ? `AI image failed: ${error.message}. Used local fallback.`
          : "AI image unavailable. Used local fallback.",
      );
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleImageUpload = async (files: FileList | null) => {
    const file = Array.from(files ?? []).find((item) => item.type.startsWith("image/"));

    if (!file) {
      setSaveNotice("Choose a PNG, JPG, or WEBP image.");
      return;
    }

    try {
      replaceImage({
        id: buildImageId(file),
        name: file.name,
        url: await readFileAsDataUrl(file),
        generated: false,
        objectUrl: false,
      });
      setSaveNotice("Image uploaded.");
    } catch {
      setSaveNotice("Uploaded image could not be read.");
    }
  };

  const handleDownloadImage = () => {
    if (!postImage) {
      return;
    }

    const anchor = document.createElement("a");

    anchor.href = postImage.url;
    anchor.download = postImage.name;
    anchor.click();
    setSaveNotice("Image download started.");
  };

  const toggleAccount = (accountId: string) => {
    setSelectedAccountIds((current) =>
      current.includes(accountId)
        ? current.filter((item) => item !== accountId)
        : [...current, accountId],
    );
  };

  const toggleSelectAllAccounts = () => {
    setSelectedAccountIds(
      selectedAll ? [] : connectedAccounts.map((account) => account.id),
    );
  };

  const updateDraft = (accountId: string, patch: Partial<SocialPostDraft>) => {
    setDrafts((current) => {
      const existing =
        current[accountId] ??
        createDraft(
          accountById[accountId]?.platform ?? "twitter",
          masterCaption,
        );

      return {
        ...current,
        [accountId]: { ...existing, ...patch },
      };
    });
  };

  const handleTweakAccountCaption = async (accountId: string) => {
    const account = accountById[accountId];

    if (!account) {
      return;
    }

    const draft = drafts[accountId];
    const instruction = (draft?.tweakInstruction ?? "").trim();

    if (!instruction) {
      setSaveNotice(`Add a ${account.displayName} tweak first.`);
      return;
    }

    updateDraft(accountId, { isTweaking: true });

    try {
      const generated = await generatePostContent(authToken, {
        prompt: captionPrompt,
        platform: account.platform,
        currentCaption: getDraftCaption(accountId) || masterCaption,
        tweakInstruction: instruction,
        imageNames: postImage ? [postImage.name] : [],
        tags: activeHashtags,
      });

      updateDraft(accountId, {
        caption: generated.caption,
        customized: true,
        isTweaking: false,
      });
      setSaveNotice(`${account.displayName} caption tweaked.`);
    } catch (error) {
      updateDraft(accountId, { isTweaking: false });
      setSaveNotice(
        error instanceof ApiError
          ? `Caption tweak failed: ${error.message}`
          : "Caption tweak unavailable.",
      );
    }
  };

  const shiftQueueMonth = (monthOffset: number) => {
    setQueueMonth((current) => new Date(current.getFullYear(), current.getMonth() + monthOffset, 1));
  };

  const setScheduledPostUpdating = useCallback((postId: string, updating: boolean) => {
    setUpdatingScheduledPostIds((current) =>
      updating
        ? [...new Set([...current, postId])]
        : current.filter((id) => id !== postId),
    );
  }, []);

  const handleRemoveScheduledPost = async (post: ScheduledSocialPost) => {
    if (!canEditScheduledPost(post)) {
      setSaveNotice("Published or publishing posts cannot be removed.");
      return;
    }

    setScheduledPostUpdating(post.id, true);

    try {
      const response = await deleteScheduledSocialPost(authToken, post.id);

      setScheduledPosts(response.posts);
      setSaveNotice(`${platformById[post.platform].label} post removed from the queue.`);
    } catch (error) {
      setSaveNotice(
        error instanceof ApiError
          ? `Remove failed: ${error.message}`
          : "Remove failed. Try again.",
      );
    } finally {
      setScheduledPostUpdating(post.id, false);
    }
  };

  const handleReschedulePost = useCallback(async (post: ScheduledSocialPost, date: Date) => {
    if (!canEditScheduledPost(post)) {
      setSaveNotice("Published or publishing posts cannot be moved.");
      return;
    }

    if (Number.isNaN(date.getTime())) {
      setSaveNotice("Choose a valid go-live date and time.");
      return;
    }

    if (date.getTime() <= Date.now()) {
      setSaveNotice("Choose a future go-live time.");
      return;
    }

    setScheduledPostUpdating(post.id, true);

    try {
      const scheduledFor = date.toISOString();
      const response = await rescheduleSocialPost(authToken, post.id, {
        scheduledFor,
        timezone: userTimezone,
      });

      setScheduledPosts(response.posts);
      setQueueMonth(new Date(date.getFullYear(), date.getMonth(), 1));
      setSaveNotice(`${platformById[post.platform].label} post moved to ${formatScheduledDateTime(scheduledFor, userTimezone)}.`);
    } catch (error) {
      setSaveNotice(
        error instanceof ApiError
          ? `Move failed: ${error.message}`
          : "Move failed. Try again.",
      );
    } finally {
      setScheduledPostUpdating(post.id, false);
    }
  }, [authToken, setScheduledPostUpdating, userTimezone]);

  const handleScheduledPostDragStart = (
    event: DragEvent<HTMLElement>,
    post: ScheduledSocialPost,
  ) => {
    if (!canEditScheduledPost(post)) {
      event.preventDefault();
      return;
    }

    setDraggedScheduledPostId(post.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", post.id);
    event.dataTransfer.setDragImage(event.currentTarget, 12, 12);
  };

  const handleCalendarDayDrop = (event: DragEvent<HTMLDivElement>, date: Date) => {
    event.preventDefault();

    const postId = event.dataTransfer.getData("text/plain") || draggedScheduledPostId;
    const post = scheduledPosts.find((item) => item.id === postId);

    setDraggedScheduledPostId(null);
    setScheduledDragPoint(null);

    if (!post) {
      return;
    }

    void handleReschedulePost(post, mergeDateWithPostTime(date, post));
  };

  const handleScheduledPostPointerDown = (
    event: PointerEvent<HTMLElement>,
    post: ScheduledSocialPost,
  ) => {
    if (
      event.button !== 0 ||
      !canEditScheduledPost(post) ||
      isInteractiveScheduledPostTarget(event.target)
    ) {
      return;
    }

    event.preventDefault();
    setDraggedScheduledPostId(post.id);
    setScheduledDragPoint({ x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  useEffect(() => {
    if (!draggedScheduledPostId) {
      return undefined;
    }

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      setScheduledDragPoint({ x: event.clientX, y: event.clientY });
    };

    const handlePointerUp = (event: globalThis.PointerEvent) => {
      const post = scheduledPosts.find((item) => item.id === draggedScheduledPostId);
      const dropTarget = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-post-calendar-day]");
      const day = calendarDays.find((item) => item.key === dropTarget?.dataset.postCalendarDay);

      setDraggedScheduledPostId(null);
      setScheduledDragPoint(null);

      if (!post || !day || getLocalDateKey(new Date(post.scheduledFor)) === day.key) {
        return;
      }

      void handleReschedulePost(post, mergeDateWithPostTime(day.date, post));
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [calendarDays, draggedScheduledPostId, handleReschedulePost, scheduledPosts]);

  const buildSelectedPosts = () =>
    selectedAccountIds
      .map((accountId) => {
        const account = accountById[accountId];

        if (!account) {
          return null;
        }

        return {
          platform: account.platform,
          accountId,
          caption: getDraftCaption(accountId).trim(),
        };
      })
      .filter(
        (
          post,
        ): post is {
          platform: SocialPlatform;
          accountId: string;
          caption: string;
        } => post !== null,
      );

  const validatePostContent = (action: "scheduling" | "publishing") => {
    if (!selectedAccountIds.length) {
      setSaveNotice(`Select at least one account before ${action}.`);
      return false;
    }

    if (!masterCaption.trim() && !postImage) {
      setSaveNotice(`Add a caption or image before ${action}.`);
      return false;
    }

    return true;
  };

  const handleOpenSchedule = () => {
    if (!validatePostContent("scheduling")) {
      return;
    }

    const scheduledDate = new Date(scheduleAt);

    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
      setScheduleAt(buildDefaultScheduleValue());
    }

    setIsScheduleModalOpen(true);
  };

  const handlePush = async () => {
    if (!validatePostContent("publishing")) {
      return;
    }

    const missingAccounts = selectedAccountIds.filter(
      (id) => !accountById[id]?.connected,
    );

    if (missingAccounts.length) {
      setSaveNotice("Reconnect the selected account(s) before pushing.");
      return;
    }

    setIsPublishingPost(true);

    try {
      const thumbnailDataUrl = postImage ? await buildCalendarImageThumbnail(postImage.url) : null;
      const response = await publishSocialPosts(authToken, {
        posts: buildSelectedPosts(),
        imageDataUrl: postImage?.url ?? null,
        imageName: postImage?.name ?? null,
        thumbnailDataUrl,
        timezone: userTimezone,
      });
      const publishedCount = response.publishedPosts.filter(
        (post) => post.status === "published",
      ).length;
      const failedCount = response.publishedPosts.length - publishedCount;

      setScheduledPosts(response.posts);
      setSaveNotice(
        failedCount
          ? `${publishedCount} published, ${failedCount} need attention in the queue.`
          : `${publishedCount} platform post${publishedCount === 1 ? "" : "s"} published.`,
      );
    } catch (error) {
      setSaveNotice(
        error instanceof ApiError
          ? error.message
          : "Unable to publish the selected posts.",
      );
    } finally {
      setIsPublishingPost(false);
    }
  };

  const handleScheduleSubmit = async () => {
    const scheduledDate = new Date(scheduleAt);

    if (!validatePostContent("scheduling")) {
      return;
    }

    if (Number.isNaN(scheduledDate.getTime())) {
      setSaveNotice("Choose a valid go-live date and time.");
      return;
    }

    if (scheduledDate.getTime() <= Date.now()) {
      setSaveNotice("Choose a future go-live time.");
      return;
    }

    if (!masterCaption.trim() && !postImage) {
      setSaveNotice("Add a caption or image before scheduling.");
      return;
    }

    setIsSchedulingPost(true);

    try {
      const scheduledFor = scheduledDate.toISOString();
      const thumbnailDataUrl = postImage ? await buildCalendarImageThumbnail(postImage.url) : null;
      const response = await scheduleSocialPosts(authToken, {
        posts: buildSelectedPosts(),
        imageDataUrl: postImage?.url ?? null,
        imageName: postImage?.name ?? null,
        thumbnailDataUrl,
        scheduledFor,
        timezone: userTimezone,
      });

      setScheduledPosts(response.posts);
      setShowScheduledQueue(true);
      setQueueMonth(new Date(scheduledDate.getFullYear(), scheduledDate.getMonth(), 1));
      setIsScheduleModalOpen(false);
      setSaveNotice(
        `${selectedAccountIds.length} post${selectedAccountIds.length === 1 ? "" : "s"} scheduled for ${formatScheduledDateTime(scheduledFor, userTimezone)}.`,
      );
    } catch (error) {
      setSaveNotice(
        error instanceof ApiError
          ? `Schedule failed: ${error.message}`
          : "Schedule failed. Try again.",
      );
    } finally {
      setIsSchedulingPost(false);
    }
  };

  return (
    <section className="post-shell">
      <div className="post-card">
        <div className="post-card__hero">
          <div>
            <div className="sidebar-section__label">Social publisher</div>
            <h1 className="post-title">Build OpsUI social posts</h1>
            <p className="post-subtitle">
              Generate caption strategy and portrait creative, then publish the post to
              your connected LinkedIn and X/Twitter accounts.
            </p>
          </div>
          <div className="post-hero__side">
            <div className="post-hero__tools">
              <button
                className="post-tool-btn"
                disabled={isPlanning || !connectedAccounts.length}
                onClick={() => void handlePlanNextPost()}
                type="button"
              >
                {isPlanning ? "Planning…" : "✨ Plan my next post"}
              </button>
              <button
                className="post-tool-btn"
                onClick={() => setIsChatOpen(true)}
                type="button"
              >
                💬 Assistant
              </button>
              <button
                className="post-tool-btn"
                onClick={() => void handleOpenHistory()}
                type="button"
              >
                🕑 History
                {pendingReviewPosts.length ? (
                  <span className="post-tool-btn__badge">{pendingReviewPosts.length}</span>
                ) : null}
              </button>
            </div>
            <div className="post-hero__pill">
              {isSocialAccountsLoading
                ? "Checking accounts"
                : `${connectedAccountCount} account${connectedAccountCount === 1 ? "" : "s"} connected`}
            </div>
          </div>
        </div>

        <div className="post-layout">
          <div className="post-compose">
            {planRationale ? (
              <div className="post-plan-rationale">
                <div className="post-plan-rationale__head">
                  <span className="eyebrow">Planner strategy</span>
                  <button
                    className="post-plan-rationale__dismiss"
                    onClick={() => setPlanRationale(null)}
                    type="button"
                    aria-label="Dismiss planner strategy"
                  >
                    x
                  </button>
                </div>
                <strong>{planRationale.angle}</strong>
                <p>{planRationale.rationale}</p>
                <div className="post-plan-rationale__meta">
                  <span>Pillar: {planRationale.contentPillar}</span>
                  <span>Framework: {planRationale.framework}</span>
                  <span>Mix: {planRationale.valueVsPromo}</span>
                  <span>Suggested: {planRationale.suggestedPostTime.slotLabel}</span>
                </div>
              </div>
            ) : null}
            <section className="post-section">
              <div className="post-section__header">
                <span className="eyebrow">Caption prompt</span>
                <h2>Write the post direction</h2>
              </div>
              <label>
                Caption Prompt
                <textarea
                  className="post-caption-input"
                  maxLength={8000}
                  onChange={(event) => setCaptionPrompt(event.target.value)}
                  placeholder="Describe the operational pain point, story, offer, or post idea..."
                  rows={8}
                  value={captionPrompt}
                />
              </label>
              <div className="post-section-actions">
                <button
                  className="post-generate-btn"
                  disabled={isGeneratingCaption}
                  onClick={() => void handleGenerateCaption()}
                  type="button"
                >
                  {isGeneratingCaption ? "Generating..." : "Generate caption"}
                </button>
                <span className="post-field-meta">{captionPrompt.length}/8000</span>
              </div>
            </section>

            <section className="post-section">
              <div className="post-section__header">
                <span className="eyebrow">Image prompt</span>
                <h2>Create or upload the visual</h2>
              </div>
              <div className="post-style-field">
                <span className="post-style-field__label">Style</span>
                <div
                  aria-label="Image style"
                  className="post-style-picker"
                  role="group"
                >
                  {imageStyles.map((style) => (
                    <button
                      aria-pressed={imageStyle === style.id}
                      className={`post-style-btn ${imageStyle === style.id ? "post-style-btn--active" : ""}`}
                      disabled={isGeneratingImage}
                      key={style.id}
                      onClick={() => handleSelectImageStyle(style.id)}
                      type="button"
                    >
                      {style.label}
                    </button>
                  ))}
                </div>
                <p className="post-style-hint">
                  {imageStyles.find((style) => style.id === imageStyle)?.hint}
                </p>
              </div>
              <label>
                Image Prompt
                <textarea
                  className="post-image-prompt-input"
                  maxLength={8000}
                  onChange={(event) => setImagePrompt(event.target.value)}
                  placeholder="Describe the image style, message, layout, and operational context..."
                  rows={7}
                  value={imagePrompt}
                />
              </label>
              <div className="post-section-actions">
                <div className="post-section-actions__group">
                  <button
                    className="post-generate-btn"
                    disabled={isGeneratingImage}
                    onClick={() => void handleGenerateImage()}
                    type="button"
                  >
                    {isGeneratingImage ? "Generating..." : "Generate image"}
                  </button>
                  <button
                    className="post-memory-btn"
                    disabled={isGeneratingImage}
                    onClick={handleResetImageMemory}
                    type="button"
                  >
                    Reset memory
                  </button>
                </div>
                <span className="post-field-meta">{imagePrompt.length}/8000</span>
              </div>

              <label className="post-upload">
                <span className="post-upload__icon">+</span>
                <span>
                  <strong>Upload or replace image</strong>
                  <small>PNG, JPG, WEBP, or generated image. One active image.</small>
                </span>
                <input
                  accept="image/*"
                  onChange={(event) => {
                    void handleImageUpload(event.target.files);
                    event.currentTarget.value = "";
                  }}
                  type="file"
                />
              </label>

              {postImage ? (
                <div className="post-image-item">
                  <img alt="" src={postImage.url} />
                  <span>{postImage.name}</span>
                  <div className="post-image-item__actions">
                    {postImage.generated ? (
                      <button
                        className="post-image-item__save"
                        onClick={handleDownloadImage}
                        type="button"
                      >
                        Save
                      </button>
                    ) : null}
                    <button
                      className="post-image-item__remove"
                      onClick={() => replaceImage(null)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="post-section">
              <div className="post-section__header">
                <span className="eyebrow">Channels</span>
                <h2>Select accounts</h2>
              </div>
              <div className="post-platform-selector">
                <button
                  className={`post-platform-btn ${selectedAll ? "post-platform-btn--active" : ""}`}
                  disabled={!connectedAccounts.length}
                  onClick={toggleSelectAllAccounts}
                  type="button"
                >
                  Select all
                </button>
                {connectedAccounts.map((account) => (
                  <button
                    aria-pressed={selectedAccountIds.includes(account.id)}
                    className={`post-platform-btn ${selectedAccountIds.includes(account.id) ? "post-platform-btn--active" : ""}`}
                    key={account.id}
                    onClick={() => toggleAccount(account.id)}
                    type="button"
                  >
                    <span>{platformById[account.platform].shortLabel}</span>
                    {account.displayName}
                  </button>
                ))}
              </div>
              <div className="post-field-meta">
                {connectedAccounts.length
                  ? `${selectedAccountIds.length} of ${connectedAccountCount} selected`
                  : "Connect an account below to start posting"}
              </div>
              <div className="post-account-list">
                {visibleSocialPlatforms.map((platform) => {
                  const accounts = accountsByVisiblePlatform[platform.id] ?? [];

                  return (
                    <div className="post-account-group" key={platform.id}>
                      {accounts.map((account) => (
                        <div
                          className={`post-account-row ${account.connected ? "post-account-row--connected" : ""}`}
                          key={account.id}
                        >
                          <div className="post-account-row__main">
                            <span className="post-account-mark">{platform.shortLabel}</span>
                            <div>
                              <strong>{account.displayName}</strong>
                              <small>
                                {account.accountId}
                                {account.hasRefreshToken ? " · auto-refresh on" : ""}
                              </small>
                            </div>
                          </div>
                          <div className="post-account-row__side">
                            <span className="post-account-status">
                              {account.source === "environment"
                                ? "Env"
                                : account.connected
                                  ? "Connected"
                                  : "Not connected"}
                            </span>
                            {canManageSocialAccounts && account.source === "database" ? (
                              <div className="post-account-actions">
                                <button
                                  onClick={() => openSocialAccountDialog(platform.id, account)}
                                  type="button"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => void handleDisconnectSocialAccount(account)}
                                  type="button"
                                >
                                  Disconnect
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))}
                      {canManageSocialAccounts ? (
                        <button
                          className="post-account-add"
                          onClick={() => openSocialAccountDialog(platform.id)}
                          type="button"
                        >
                          + Add {platform.label} account
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {canManageSocialAccounts && agentConfig
                ? (() => {
                    const agent = agentConfig;
                    const slots = agent.cadence.slots;
                    const patch = (partial: Partial<AutoPostAgentConfig>) =>
                      void saveAgentConfig({ ...agent, timezone: userTimezone, ...partial });
                    const setSlots = (next: AutoPostAgentSlot[]) =>
                      patch({ cadence: { mode: "slots", slots: next } });
                    const updateSlot = (
                      id: string,
                      partialSlot: Partial<AutoPostAgentSlot>,
                    ) =>
                      setSlots(slots.map((s) => (s.id === id ? { ...s, ...partialSlot } : s)));

                    return (
                      <div className="post-agent">
                        <div className="post-agent__header">
                          <div>
                            <strong>Auto-post agent</strong>
                            <small>
                              {agent.enabled
                                ? `On — ${slots.length} timeslot${slots.length === 1 ? "" : "s"} drafting into your review queue`
                                : "Off"}
                            </small>
                          </div>
                          <div className="post-agent__header-actions">
                            <button
                              className="post-memory-btn"
                              onClick={() => setIsAgentExpanded((value) => !value)}
                              type="button"
                            >
                              {isAgentExpanded ? "Hide" : "Settings"}
                            </button>
                            <button
                              aria-pressed={agent.enabled}
                              className={`post-agent__toggle ${agent.enabled ? "post-agent__toggle--on" : ""}`}
                              disabled={isSavingAgent}
                              onClick={() => patch({ enabled: !agent.enabled })}
                              type="button"
                            >
                              {agent.enabled ? "On" : "Off"}
                            </button>
                          </div>
                        </div>

                        {isAgentExpanded ? (
                          <div className="post-agent__settings">
                            <div className="post-agent__slots">
                              {slots.map((slot) => (
                                <div className="post-agent-slot" key={slot.id}>
                                  <div className="post-agent-slot__head">
                                    <input
                                      aria-label="Timeslot time"
                                      onChange={(event) =>
                                        updateSlot(slot.id, { time: event.target.value })
                                      }
                                      type="time"
                                      value={slot.time}
                                    />
                                    <button
                                      aria-label="Remove timeslot"
                                      className="post-agent-slot__remove"
                                      onClick={() =>
                                        setSlots(slots.filter((s) => s.id !== slot.id))
                                      }
                                      type="button"
                                    >
                                      ×
                                    </button>
                                  </div>

                                  <div className="post-agent-slot__field">
                                    <span>Days</span>
                                    <div className="post-platform-selector">
                                      {calendarWeekdays.map((label, day) => (
                                        <button
                                          className={`post-platform-btn ${slot.days.includes(day) ? "post-platform-btn--active" : ""}`}
                                          key={day}
                                          onClick={() => {
                                            const nextDays = slot.days.includes(day)
                                              ? slot.days.filter((d) => d !== day)
                                              : [...slot.days, day].sort((a, b) => a - b);
                                            if (nextDays.length) {
                                              updateSlot(slot.id, { days: nextDays });
                                            }
                                          }}
                                          type="button"
                                        >
                                          {label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  <div className="post-agent-slot__field">
                                    <span>Accounts (none = all connected)</span>
                                    <div className="post-platform-selector">
                                      {connectedAccounts.map((account) => (
                                        <button
                                          className={`post-platform-btn ${slot.accountIds.includes(account.id) ? "post-platform-btn--active" : ""}`}
                                          key={account.id}
                                          onClick={() =>
                                            updateSlot(slot.id, {
                                              accountIds: slot.accountIds.includes(account.id)
                                                ? slot.accountIds.filter((id) => id !== account.id)
                                                : [...slot.accountIds, account.id],
                                            })
                                          }
                                          type="button"
                                        >
                                          <span>{platformById[account.platform].shortLabel}</span>
                                          {account.displayName}
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  <div className="post-agent-slot__field">
                                    <span>Posts</span>
                                    <div className="post-platform-selector">
                                      {[1, 2, 3, 4].map((count) => (
                                        <button
                                          className={`post-platform-btn ${slot.postsPerRun === count ? "post-platform-btn--active" : ""}`}
                                          key={count}
                                          onClick={() => updateSlot(slot.id, { postsPerRun: count })}
                                          type="button"
                                        >
                                          {count}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              ))}

                              {slots.length < 12 ? (
                                <button
                                  className="post-account-add"
                                  onClick={() =>
                                    setSlots([
                                      ...slots,
                                      {
                                        id: crypto.randomUUID(),
                                        time: "12:00",
                                        days: [1, 2, 3, 4, 5],
                                        accountIds: [],
                                        postsPerRun: 1,
                                      },
                                    ])
                                  }
                                  type="button"
                                >
                                  + Add timeslot
                                </button>
                              ) : null}

                              {!slots.length ? (
                                <p className="post-account-hint">
                                  No timeslots yet — add one to start drafting.
                                </p>
                              ) : null}
                            </div>

                            <div className="post-agent__field">
                              <span>Image style</span>
                              <div className="post-style-picker">
                                {imageStyles.map((style) => (
                                  <button
                                    className={`post-style-btn ${agent.imageStyle === style.id ? "post-style-btn--active" : ""}`}
                                    key={style.id}
                                    onClick={() => patch({ imageStyle: style.id })}
                                    type="button"
                                  >
                                    {style.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <p className="post-account-hint">
                              Timezone {userTimezone}. Each timeslot plans &amp; generates posts
                              (with the hardlocked OpsUI references) for its account(s) into your
                              review queue. Nothing publishes until you approve it.
                            </p>
                          </div>
                        ) : null}
                      </div>
                    );
                  })()
                : null}
            </section>
          </div>

          <aside className="post-preview-panel" aria-label="Master post preview">
            <div className="post-preview-panel__header">
              <span className="eyebrow">Master preview</span>
              <h2>Review before platform edits</h2>
            </div>

            <article className="post-preview">
              <div className="post-preview__top">
                <img alt="OpsUI" className="post-preview__avatar" src={opsLogo} />
                <div>
                  <strong>OpsUI</strong>
                  <span>{previewTime}</span>
                </div>
              </div>

              <label className="post-preview__caption-editor">
                <span>Caption</span>
                <textarea
                  ref={masterCaptionInputRef}
                  className="post-preview__caption-input"
                  maxLength={maxCaptionLength}
                  onChange={(event) => handleMasterCaptionChange(event.target.value)}
                  placeholder="Generated caption appears here. You can edit it before platform previews."
                  rows={5}
                  value={masterCaption}
                />
                <small>{masterCaption.length}/{maxCaptionLength}</small>
              </label>

              {postImage ? (
                <div className="post-preview__image post-preview__image--portrait">
                  <img alt="Master post preview" src={postImage.url} />
                </div>
              ) : (
                <div className="post-preview__empty-image">Image preview</div>
              )}

              <div className="post-preview__tags">
                {activeHashtags.map((tag) => `#${tag}`).join(" ")}
              </div>

              <div className="post-preview__metrics">
                <span>{readyToPreview ? "Ready to preview" : "Needs content"}</span>
                <span>{hasImage ? "Image ready" : "No image"}</span>
                <span>{captionStrategy ? captionStrategy.model : "No caption model"}</span>
              </div>
            </article>

            {captionStrategy ? (
              <details className="post-strategy" open>
                <summary>Caption strategy</summary>
                <div className="post-strategy__body">
                  <div>
                    <span className="eyebrow">Alternatives</span>
                    <div className="post-alt-list">
                      {captionStrategy.alternatives.map((alternative, index) => (
                        <button
                          key={`${alternative}-${index}`}
                          onClick={() => handleMasterCaptionChange(alternative)}
                          type="button"
                        >
                          {alternative}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="eyebrow">Hashtag bank</span>
                    <div className="post-tag-row">
                      {captionStrategy.hashtagBank.map((tag) => (
                        <span className="post-tag-chip" key={tag}>#{tag}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="eyebrow">Posting style</span>
                    <p>{captionStrategy.postingStyleRecommendation}</p>
                  </div>
                  <div>
                    <span className="eyebrow">CTA options</span>
                    <div className="post-cta-list">
                      {captionStrategy.ctaOptions.map((cta) => (
                        <button
                          key={cta}
                          onClick={() => handleMasterCaptionChange(`${masterCaption.trim()}\n\n${cta}`.trim())}
                          type="button"
                        >
                          {cta}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </details>
            ) : null}
          </aside>
        </div>

        <section className="post-platform-queue">
          <div className="post-platform-queue__header">
            <div>
              <span className="eyebrow">Platform previews</span>
              <h2>Ready queue</h2>
            </div>
            <div className="post-schedule-actions">
              <button
                className="post-schedule-btn"
                disabled={!selectedAccountIds.length || isSchedulingPost || isPublishingPost}
                onClick={handleOpenSchedule}
                type="button"
              >
                Schedule
              </button>
              <button
                className="post-push-btn"
                disabled={!selectedAccountIds.length || isPublishingPost || isSchedulingPost}
                onClick={() => void handlePush()}
                type="button"
              >
                {isPublishingPost ? "Pushing..." : "Push"}
              </button>
            </div>
          </div>

          {selectedAccountIds.length ? (
            <div className="post-platform-grid">
              {selectedAccountIds.map((accountId) => {
                const account = accountById[accountId];

                if (!account) {
                  return null;
                }

                const meta = platformById[account.platform];
                const caption = getDraftCaption(accountId);
                const draft = drafts[accountId];
                const overLimit = caption.length > meta.captionLimit;

                return (
                  <article className="post-platform-card" key={accountId}>
                    <div className="post-platform-card__top">
                      <div className="post-platform-card__mark">{meta.shortLabel}</div>
                      <div>
                        <strong>{account.displayName}</strong>
                        <span>{account.accountId}</span>
                      </div>
                    </div>

                    {postImage ? (
                      <div className="post-platform-card__image">
                        <img alt={`${account.displayName} preview`} src={postImage.url} />
                      </div>
                    ) : (
                      <div className="post-preview__empty-image">No image selected</div>
                    )}

                    <label className="post-preview__caption-editor">
                      <span>Final caption</span>
                      <textarea
                        className="post-platform-caption"
                        maxLength={maxCaptionLength}
                        onChange={(event) =>
                          updateDraft(accountId, {
                            caption: event.target.value,
                            customized: true,
                          })
                        }
                        rows={8}
                        value={caption}
                      />
                      <small className={overLimit ? "post-platform-limit--warn" : undefined}>
                        {caption.length}/{meta.captionLimit} recommended
                      </small>
                    </label>

                    <label className="post-platform-tweak">
                      <span>Tweak prompt for {account.displayName}</span>
                      <textarea
                        maxLength={2000}
                        onChange={(event) =>
                          updateDraft(accountId, {
                            tweakInstruction: event.target.value,
                          })
                        }
                        placeholder={`Example: Make this more ${meta.label}-native without changing the core point.`}
                        rows={3}
                        value={draft?.tweakInstruction ?? ""}
                      />
                    </label>

                    <div className="post-platform-card__actions">
                      <span>{meta.styleHint}</span>
                      <button
                        disabled={draft?.isTweaking ?? false}
                        onClick={() => void handleTweakAccountCaption(accountId)}
                        type="button"
                      >
                        {draft?.isTweaking ? "Tweaking..." : "Tweak caption"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="post-platform-empty">
              Select one or more accounts to see final previews.
            </div>
          )}
        </section>
      </div>

      {showScheduledQueue ? (
        <div
          className="post-calendar-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="post-calendar-title"
        >
          <div className="post-schedule-modal__backdrop" onClick={() => setShowScheduledQueue(false)} />
          <section
            className={`post-calendar-dialog ${selectedQueuePost ? "post-calendar-dialog--with-detail" : ""}`}
            aria-label="Scheduled social post queue"
          >
            <div className="post-queue-main">
              <div className="post-calendar-panel__header">
                <div>
                  <span className="eyebrow">Scheduled queue</span>
                  <h2 id="post-calendar-title">
                    {queueViewMode === "calendar" ? queueMonthLabel : "Agenda"}
                  </h2>
                  <p>
                    {isScheduledQueueLoading
                      ? "Loading shared queue..."
                      : `${filteredScheduledPosts.length} post${filteredScheduledPosts.length === 1 ? "" : "s"}${filteredScheduledPosts.length !== sortedScheduledPosts.length ? ` of ${sortedScheduledPosts.length}` : ""}`}
                  </p>
                </div>
                <div className="post-calendar-actions">
                  {queueViewMode === "calendar" ? (
                    <>
                      <button onClick={() => shiftQueueMonth(-1)} type="button">
                        Prev
                      </button>
                      <button onClick={() => setQueueMonth(new Date())} type="button">
                        Today
                      </button>
                      <button onClick={() => shiftQueueMonth(1)} type="button">
                        Next
                      </button>
                    </>
                  ) : null}
                  <button
                    className="post-calendar-close-btn"
                    onClick={() => setShowScheduledQueue(false)}
                    type="button"
                    aria-label="Close post calendar"
                  >
                    x
                  </button>
                </div>
              </div>

              <div className="post-queue-toolbar">
                <div className="post-queue-filters">
                  <select
                    aria-label="Filter by platform"
                    onChange={(event) =>
                      setQueueFilters((current) => ({
                        ...current,
                        platform: event.target.value as SocialPlatform | "all",
                      }))
                    }
                    value={queueFilters.platform}
                  >
                    <option value="all">All platforms</option>
                    {visiblePlatformIds.map((platform) => (
                      <option key={platform} value={platform}>
                        {platformById[platform].label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filter by account"
                    onChange={(event) =>
                      setQueueFilters((current) => ({
                        ...current,
                        accountId: event.target.value,
                      }))
                    }
                    value={queueFilters.accountId}
                  >
                    <option value="all">All accounts</option>
                    {connectedAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.displayName}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filter by status"
                    onChange={(event) =>
                      setQueueFilters((current) => ({
                        ...current,
                        status: event.target.value as ScheduledSocialPostStatus | "all",
                      }))
                    }
                    value={queueFilters.status}
                  >
                    <option value="all">All statuses</option>
                    {(
                      [
                        "pending_review",
                        "scheduled",
                        "publishing",
                        "published",
                        "failed",
                        "connection_required",
                        "cancelled",
                      ] as ScheduledSocialPostStatus[]
                    ).map((status) => (
                      <option key={status} value={status}>
                        {status.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="post-queue-viewtoggle post-platform-selector">
                  <button
                    className={`post-platform-btn ${queueViewMode === "calendar" ? "post-platform-btn--active" : ""}`}
                    onClick={() => setQueueViewMode("calendar")}
                    type="button"
                  >
                    Calendar
                  </button>
                  <button
                    className={`post-platform-btn ${queueViewMode === "agenda" ? "post-platform-btn--active" : ""}`}
                    onClick={() => setQueueViewMode("agenda")}
                    type="button"
                  >
                    Agenda
                  </button>
                </div>
              </div>

              {pendingReviewVisible.length ? (
                <div className="post-queue-bulkbar">
                  <label>
                    <input
                      checked={
                        selectedReviewIds.length === pendingReviewVisible.length &&
                        pendingReviewVisible.length > 0
                      }
                      onChange={(event) =>
                        setSelectedReviewIds(
                          event.target.checked
                            ? pendingReviewVisible.map((post) => post.id)
                            : [],
                        )
                      }
                      type="checkbox"
                    />
                    Select all ({pendingReviewVisible.length} pending)
                  </label>
                  <span>{selectedReviewIds.length} selected</span>
                  <button
                    disabled={!selectedReviewIds.length || isBulkBusy}
                    onClick={() => void handleBulkReview("approve")}
                    type="button"
                  >
                    Approve all
                  </button>
                  <button
                    disabled={!selectedReviewIds.length || isBulkBusy}
                    onClick={() => void handleBulkReview("reject")}
                    type="button"
                  >
                    Reject all
                  </button>
                </div>
              ) : null}

              {queueViewMode === "calendar" ? (
                <div className="post-calendar-grid">
                  {calendarWeekdays.map((weekday) => (
                    <div className="post-calendar-weekday" key={weekday}>
                      {weekday}
                    </div>
                  ))}
                  {calendarDays.map((day) => (
                    <div
                      className={[
                        "post-calendar-day",
                        day.inCurrentMonth ? "" : "post-calendar-day--muted",
                        draggedScheduledPostId ? "post-calendar-day--drop-ready" : "",
                        getLocalDateKey(day.date) === getLocalDateKey(new Date())
                          ? "post-calendar-day--today"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(event) => handleCalendarDayDrop(event, day.date)}
                      data-post-calendar-day={day.key}
                      key={day.key}
                    >
                      <div className="post-calendar-day__number">{day.date.getDate()}</div>
                      <div className="post-calendar-day__events">
                        {day.events.slice(0, 3).map((event) => renderQueueEvent(event))}
                        {day.events.length > 3 ? (
                          <span className="post-calendar-more">
                            +{day.events.length - 3} more
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="post-agenda-list">
                  {agendaGroups.length ? (
                    agendaGroups.map(([key, events]) => (
                      <div className="post-agenda-day" key={key}>
                        <h3>{formatScheduledDateTime(events[0].scheduledFor, userTimezone).split(",")[0]}</h3>
                        <div className="post-agenda-day__events">
                          {events.map((event) => renderQueueEvent(event))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="post-calendar-note">No posts match these filters.</p>
                  )}
                </div>
              )}

              {draggedScheduledPost && scheduledDragPoint
                ? (() => {
                    const meta = platformById[draggedScheduledPost.platform];

                    return (
                      <article
                        className="post-calendar-drag-ghost post-calendar-event"
                        style={{
                          transform: `translate(${scheduledDragPoint.x + 12}px, ${scheduledDragPoint.y + 12}px)`,
                        }}
                      >
                        {draggedScheduledPost.thumbnailDataUrl ? (
                          <img
                            alt={draggedScheduledPost.imageName ?? `${meta.label} scheduled image`}
                            draggable={false}
                            src={draggedScheduledPost.thumbnailDataUrl}
                          />
                        ) : (
                          <span className="post-calendar-event__placeholder">{meta.shortLabel}</span>
                        )}
                        <div className="post-calendar-event__details">
                          <span>{meta.label}</span>
                          <strong>{formatScheduledTime(draggedScheduledPost.scheduledFor, draggedScheduledPost.timezone)}</strong>
                          <small>{draggedScheduledPost.status.replace(/_/g, " ")}</small>
                        </div>
                      </article>
                    );
                  })()
                : null}

              <p className="post-calendar-note">
                Times use {userTimezone}. The queue is shared with every OpsUI member.
                Click a post to edit, preview, publish now, or duplicate it.
              </p>
            </div>

            {selectedQueuePost ? (
              <aside className="post-queue-detail" aria-label="Post detail">
                <div className="post-queue-detail__head">
                  <strong>
                    {platformById[selectedQueuePost.platform].label}
                    {selectedQueuePost.accountId && accountById[selectedQueuePost.accountId]
                      ? ` · ${accountById[selectedQueuePost.accountId].displayName}`
                      : ""}
                  </strong>
                  <button
                    aria-label="Close detail"
                    className="post-calendar-close-btn"
                    onClick={() => setSelectedQueuePostId(null)}
                    type="button"
                  >
                    x
                  </button>
                </div>

                <div className="post-queue-detail__preview">
                  {selectedQueuePost.imageName || selectedQueuePost.thumbnailDataUrl ? (
                    <img
                      alt={selectedQueuePost.imageName ?? "Scheduled post image"}
                      src={
                        selectedQueuePost.imageName
                          ? scheduledPostImageUrl(selectedQueuePost.id)
                          : selectedQueuePost.thumbnailDataUrl ?? ""
                      }
                    />
                  ) : (
                    <div className="post-queue-detail__noimage">No image</div>
                  )}
                </div>

                <small className="post-queue-detail__meta">
                  {selectedQueuePost.status.replace(/_/g, " ")} ·{" "}
                  {formatScheduledDateTime(selectedQueuePost.scheduledFor, selectedQueuePost.timezone)}
                </small>

                <textarea
                  className="post-detail-caption"
                  disabled={!canEditScheduledPost(selectedQueuePost)}
                  onChange={(event) => setDetailCaptionDraft(event.target.value)}
                  rows={6}
                  value={detailCaptionDraft}
                />

                <div className="post-detail-actions">
                  <button
                    disabled={
                      isSavingCaption ||
                      !canEditScheduledPost(selectedQueuePost) ||
                      detailCaptionDraft === selectedQueuePost.caption
                    }
                    onClick={() => void handleSaveDetailCaption(selectedQueuePost)}
                    type="button"
                  >
                    {isSavingCaption ? "Saving..." : "Save caption"}
                  </button>
                  {selectedQueuePost.status === "pending_review" ? (
                    <button
                      disabled={updatingScheduledPostIds.includes(selectedQueuePost.id)}
                      onClick={() => void handleReviewPost(selectedQueuePost, "approve")}
                      type="button"
                    >
                      Approve
                    </button>
                  ) : null}
                  <button
                    disabled={
                      updatingScheduledPostIds.includes(selectedQueuePost.id) ||
                      !["scheduled", "failed", "connection_required", "pending_review"].includes(
                        selectedQueuePost.status,
                      )
                    }
                    onClick={() => void handlePublishNow(selectedQueuePost)}
                    type="button"
                  >
                    Publish now
                  </button>
                  <button
                    disabled={updatingScheduledPostIds.includes(selectedQueuePost.id)}
                    onClick={() => void handleDuplicatePost(selectedQueuePost)}
                    type="button"
                  >
                    Duplicate
                  </button>
                  <button
                    disabled={
                      !canEditScheduledPost(selectedQueuePost) ||
                      updatingScheduledPostIds.includes(selectedQueuePost.id)
                    }
                    onClick={() =>
                      void (selectedQueuePost.status === "pending_review"
                        ? handleReviewPost(selectedQueuePost, "reject")
                        : handleRemoveScheduledPost(selectedQueuePost))
                    }
                    type="button"
                  >
                    {selectedQueuePost.status === "pending_review" ? "Reject" : "Remove"}
                  </button>
                </div>
              </aside>
            ) : null}
          </section>
        </div>
      ) : null}

      {connectPlatform ? (
        <div
          className="post-account-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="post-account-title"
        >
          <div className="post-schedule-modal__backdrop" onClick={closeSocialAccountDialog} />
          <section className="post-account-dialog">
            <div className="post-schedule-dialog__header">
              <div>
                <span className="eyebrow">Account connection</span>
                <h2 id="post-account-title">
                  {editingAccountId ? "Edit" : "Add"} {platformById[connectPlatform].label} account
                </h2>
              </div>
              <button
                className="post-schedule-dialog__close"
                onClick={closeSocialAccountDialog}
                type="button"
                aria-label="Close account connection dialog"
              >
                x
              </button>
            </div>

            <div className="post-account-form">
              <label>
                Display name
                <input
                  maxLength={120}
                  onChange={(event) =>
                    setAccountForm((current) => ({
                      ...current,
                      displayName: event.target.value,
                    }))
                  }
                  value={accountForm.displayName}
                />
              </label>
              <label>
                Posting target ID
                <input
                  maxLength={240}
                  onChange={(event) =>
                    setAccountForm((current) => ({
                      ...current,
                      accountId: event.target.value,
                    }))
                  }
                  placeholder={
                    connectPlatform === "linkedin"
                      ? "urn:li:organization:123456"
                      : connectPlatform === "twitter"
                        ? "@opsui"
                        : "Platform account ID"
                  }
                  value={accountForm.accountId}
                />
              </label>
              <label>
                Access token
                <input
                  maxLength={8000}
                  onChange={(event) =>
                    setAccountForm((current) => ({
                      ...current,
                      accessToken: event.target.value,
                    }))
                  }
                  type="password"
                  value={accountForm.accessToken}
                />
              </label>
              {connectPlatform === "twitter" ? (
                <label>
                  Refresh token (optional)
                  <input
                    maxLength={8000}
                    onChange={(event) =>
                      setAccountForm((current) => ({
                        ...current,
                        refreshToken: event.target.value,
                      }))
                    }
                    placeholder={
                      editingAccountId
                        ? "Leave blank to keep the saved refresh token"
                        : "Paste to enable automatic token refresh"
                    }
                    type="password"
                    value={accountForm.refreshToken}
                  />
                  <small className="post-account-hint">
                    Enables auto-refresh so you don't re-paste X tokens every ~2 hours.
                    Set OPSUI_X_CLIENT_ID and OPSUI_X_CLIENT_SECRET on the API.
                  </small>
                </label>
              ) : null}
              <label>
                Token expiry
                <input
                  onChange={(event) =>
                    setAccountForm((current) => ({
                      ...current,
                      expiresAt: event.target.value,
                    }))
                  }
                  type="datetime-local"
                  value={accountForm.expiresAt}
                />
              </label>
            </div>

            <div className="post-schedule-dialog__actions">
              <button
                className="post-schedule-cancel"
                onClick={closeSocialAccountDialog}
                type="button"
              >
                Cancel
              </button>
              <button
                className="post-schedule-confirm"
                disabled={isSavingSocialAccount}
                onClick={() => void handleSaveSocialAccount()}
                type="button"
              >
                {isSavingSocialAccount ? "Saving..." : "Save account"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isScheduleModalOpen ? (
        <div
          className="post-schedule-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="post-schedule-title"
        >
          <div className="post-schedule-modal__backdrop" onClick={() => setIsScheduleModalOpen(false)} />
          <section className="post-schedule-dialog">
            <div className="post-schedule-dialog__header">
              <div>
                <span className="eyebrow">Schedule post</span>
                <h2 id="post-schedule-title">Choose go-live time</h2>
              </div>
              <button
                className="post-schedule-dialog__close"
                onClick={() => setIsScheduleModalOpen(false)}
                type="button"
                aria-label="Close schedule dialog"
              >
                x
              </button>
            </div>

            <div className="post-schedule-summary">
              <div>
                <span>Accounts</span>
                <strong>{selectedAccountIds.length} selected</strong>
              </div>
              <div>
                <span>Timezone</span>
                <strong>{userTimezone}</strong>
              </div>
            </div>

            <div className="post-schedule-platform-row">
              {selectedAccountIds.map((accountId) => (
                <span key={accountId}>
                  {accountById[accountId]?.displayName ?? accountId}
                </span>
              ))}
            </div>

            <label className="post-schedule-picker">
              <span>Date and time</span>
              <input
                autoFocus
                min={minimumScheduleAt}
                onChange={(event) => setScheduleAt(event.target.value)}
                type="datetime-local"
                value={scheduleAt}
              />
            </label>

            <div className="post-schedule-dialog__actions">
              <button
                className="post-schedule-cancel"
                onClick={() => setIsScheduleModalOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="post-schedule-confirm"
                disabled={isSchedulingPost}
                onClick={() => void handleScheduleSubmit()}
                type="button"
              >
                {isSchedulingPost ? "Scheduling..." : "Schedule post"}
              </button>
            </div>

            <p>
              Scheduled posts are stored in the shared OpsUI queue. When the publish
              time arrives, the server will send them through connected platform
              accounts.
            </p>
          </section>
        </div>
      ) : null}

      {isHistoryOpen ? (
        <div className="post-drawer" role="dialog" aria-modal="true" aria-label="Post history">
          <div
            className="post-schedule-modal__backdrop"
            onClick={() => setIsHistoryOpen(false)}
          />
          <section className="post-drawer__panel">
            <div className="post-schedule-dialog__header">
              <div>
                <span className="eyebrow">History &amp; review</span>
                <h2>The assistant uses this as context</h2>
              </div>
              <button
                className="post-schedule-dialog__close"
                onClick={() => setIsHistoryOpen(false)}
                type="button"
                aria-label="Close history"
              >
                x
              </button>
            </div>

            {pendingReviewPosts.length ? (
              <div className="post-history-section">
                <span className="eyebrow">Pending review ({pendingReviewPosts.length})</span>
                <div className="post-history-list">
                  {pendingReviewPosts.map((post) => (
                    <div className="post-history-item post-history-item--pending" key={post.id}>
                      {post.thumbnailDataUrl ? (
                        <img alt="" src={post.thumbnailDataUrl} />
                      ) : (
                        <span className="post-calendar-event__placeholder">
                          {platformById[post.platform].shortLabel}
                        </span>
                      )}
                      <div className="post-history-item__body">
                        <small>
                          {platformById[post.platform].label} ·{" "}
                          {formatScheduledDateTime(post.scheduledFor, post.timezone)}
                        </small>
                        <p>{post.caption}</p>
                        <div className="post-history-item__actions">
                          <button
                            disabled={updatingScheduledPostIds.includes(post.id)}
                            onClick={() => void handleReviewPost(post, "approve")}
                            type="button"
                          >
                            Approve
                          </button>
                          <button
                            disabled={updatingScheduledPostIds.includes(post.id)}
                            onClick={() => void handleReviewPost(post, "approve", true)}
                            type="button"
                          >
                            Publish now
                          </button>
                          <button
                            disabled={updatingScheduledPostIds.includes(post.id)}
                            onClick={() => void handleReviewPost(post, "reject")}
                            type="button"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="post-history-section">
              <span className="eyebrow">Recent posts &amp; generations</span>

              <div className="post-history-filters">
                {(
                  [
                    { key: "all", label: "All" },
                    { key: "posts", label: "Posts" },
                    { key: "generations", label: "Generations" },
                  ] as Array<{ key: "all" | "posts" | "generations"; label: string }>
                ).map((chip) => (
                  <button
                    className={`post-history-chip ${historyFilter.kind === chip.key ? "post-history-chip--active" : ""}`}
                    key={chip.key}
                    onClick={() =>
                      setHistoryFilter((current) => ({ ...current, kind: chip.key }))
                    }
                    type="button"
                  >
                    {chip.label}
                  </button>
                ))}
                {historyAccounts.length ? (
                  <>
                    <button
                      className={`post-history-chip ${historyFilter.accountId === "all" ? "post-history-chip--active" : ""}`}
                      onClick={() =>
                        setHistoryFilter((current) => ({ ...current, accountId: "all" }))
                      }
                      type="button"
                    >
                      All accounts
                    </button>
                    {historyAccounts.map((account) => (
                      <button
                        className={`post-history-chip ${historyFilter.accountId === account.id ? "post-history-chip--active" : ""}`}
                        key={account.id}
                        onClick={() =>
                          setHistoryFilter((current) => ({
                            ...current,
                            accountId: account.id,
                          }))
                        }
                        type="button"
                      >
                        {account.label}
                      </button>
                    ))}
                  </>
                ) : null}
              </div>

              {isHistoryLoading ? (
                <p className="post-account-hint">Loading history…</p>
              ) : filteredHistoryItems.length ? (
                historyGroups.map(([groupLabel, items]) => (
                  <div className="post-history-group" key={groupLabel}>
                    <span className="post-history-group__label eyebrow">{groupLabel}</span>
                    <div className="post-history-list">
                      {items.map((item) => (
                        <div className="post-history-item" key={`${item.kind}-${item.id}`}>
                          {item.thumbnailDataUrl ? (
                            <img alt="" src={item.thumbnailDataUrl} />
                          ) : (
                            <span className="post-calendar-event__placeholder">
                              {item.kind === "published" ? "POST" : "DRAFT"}
                            </span>
                          )}
                          <div className="post-history-item__body">
                            <small>
                              {item.kind === "published" ? "Published" : "Caption draft"}
                              {item.accountLabel
                                ? ` · ${item.accountLabel}`
                                : item.platform
                                  ? ` · ${item.platform}`
                                  : ""}{" "}
                              · {formatScheduledDateTime(item.createdAt, userTimezone)}
                            </small>
                            <p>{item.caption ?? item.prompt}</p>
                            <div className="post-history-item__actions">
                              <button onClick={() => handleReuseHistory(item)} type="button">
                                Reuse
                              </button>
                              <button
                                disabled={isPlanning}
                                onClick={() => void handleUseAsBasis(item)}
                                type="button"
                              >
                                Use as basis
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <p className="post-account-hint">
                  {historyItems.length
                    ? "No history matches these filters."
                    : "No history yet — publish a post or generate a caption to build context."}
                </p>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {isChatOpen ? (
        <div className="post-drawer" role="dialog" aria-modal="true" aria-label="Strategy assistant">
          <div
            className="post-schedule-modal__backdrop"
            onClick={() => setIsChatOpen(false)}
          />
          <section className="post-drawer__panel post-chat-panel">
            <div className="post-schedule-dialog__header">
              <div>
                <span className="eyebrow">Strategy assistant</span>
                <h2>Plan &amp; refine OpsUI posts</h2>
              </div>
              <button
                className="post-schedule-dialog__close"
                onClick={() => setIsChatOpen(false)}
                type="button"
                aria-label="Close assistant"
              >
                x
              </button>
            </div>

            <div className="post-chat-thread">
              {chatMessages.length ? (
                chatMessages.map((message, index) => (
                  <div
                    className={`post-chat-msg post-chat-msg--${message.role}`}
                    key={index}
                  >
                    {message.content}
                  </div>
                ))
              ) : (
                <p className="post-account-hint">
                  Ask for content ideas, critique a draft, or say “draft a post about…”
                  and the assistant hands it to the planner.
                </p>
              )}
              {isChatSending ? (
                <div className="post-chat-msg post-chat-msg--assistant">Thinking…</div>
              ) : null}
            </div>

            <div className="post-chat-composer">
              <textarea
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSendChat();
                  }
                }}
                placeholder="Message the strategy assistant…"
                rows={3}
                value={chatInput}
              />
              <button
                className="post-generate-btn"
                disabled={isChatSending || !chatInput.trim()}
                onClick={() => void handleSendChat()}
                type="button"
              >
                {isChatSending ? "Sending…" : "Send"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {saveNotice ? (
        <div className="post-save-toast" role="status" aria-live="polite">
          {saveNotice}
        </div>
      ) : null}
    </section>
  );
};

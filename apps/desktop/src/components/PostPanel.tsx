import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, PointerEvent } from "react";
import type {
  AiPostContent,
  ScheduledSocialPlatform,
  ScheduledSocialPost,
} from "@opsui/shared";
import opsLogo from "../assets/op.png";
import {
  ApiError,
  deleteScheduledSocialPost,
  generatePostContent,
  generatePostImage,
  getScheduledSocialPosts,
  rescheduleSocialPost,
  scheduleSocialPosts,
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

type CalendarDay = {
  key: string;
  date: Date;
  inCurrentMonth: boolean;
  events: ScheduledSocialPost[];
};

type Props = {
  authToken: string;
};

type PlatformMeta = {
  id: SocialPlatform;
  label: string;
  shortLabel: string;
  captionLimit: number;
  previewMeta: string;
  styleHint: string;
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

const platformIds = socialPlatforms.map((platform) => platform.id);
const platformById = Object.fromEntries(
  socialPlatforms.map((platform) => [platform.id, platform]),
) as Record<SocialPlatform, PlatformMeta>;
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

const createDrafts = (caption: string): Record<SocialPlatform, SocialPostDraft> =>
  Object.fromEntries(
    platformIds.map((platform) => [
      platform,
      {
        platform,
        caption,
        customized: false,
        tweakInstruction: "",
        isTweaking: false,
      },
    ]),
  ) as Record<SocialPlatform, SocialPostDraft>;

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

const formatDateInputValue = (date: Date) =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;

const formatTimeInputValue = (date: Date) =>
  `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;

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
  ["scheduled", "failed", "connection_required"].includes(post.status);

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

export const PostPanel = ({ authToken }: Props) => {
  const [captionPrompt, setCaptionPrompt] = useState(defaultCaptionPrompt);
  const [imagePrompt, setImagePrompt] = useState(defaultImagePrompt);
  const [masterCaption, setMasterCaption] = useState("");
  const [captionStrategy, setCaptionStrategy] = useState<AiPostContent | null>(null);
  const [postImage, setPostImage] = useState<PostImage | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<SocialPlatform[]>([]);
  const [drafts, setDrafts] = useState(createDrafts(""));
  const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isSchedulingPost, setIsSchedulingPost] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [scheduleAt, setScheduleAt] = useState(buildDefaultScheduleValue);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledSocialPost[]>([]);
  const [isScheduledQueueLoading, setIsScheduledQueueLoading] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [showScheduledQueue, setShowScheduledQueue] = useState(false);
  const [queueMonth, setQueueMonth] = useState(() => new Date());
  const [draggedScheduledPostId, setDraggedScheduledPostId] = useState<string | null>(null);
  const [scheduledDragPoint, setScheduledDragPoint] = useState<{ x: number; y: number } | null>(null);
  const [updatingScheduledPostIds, setUpdatingScheduledPostIds] = useState<string[]>([]);
  const masterCaptionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const postImageRef = useRef<PostImage | null>(null);
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
  const selectedAll = selectedPlatforms.length === platformIds.length;
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
  const calendarDays = useMemo(
    () => buildCalendarDays(queueMonth, sortedScheduledPosts),
    [queueMonth, sortedScheduledPosts],
  );
  const draggedScheduledPost = useMemo(
    () =>
      draggedScheduledPostId
        ? scheduledPosts.find((post) => post.id === draggedScheduledPostId) ?? null
        : null,
    [draggedScheduledPostId, scheduledPosts],
  );
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
  }, [calendarDays, draggedScheduledPostId, scheduledPosts]);

  const replaceImage = (image: PostImage | null) => {
    setPostImage((current) => {
      revokePostImage(current);
      return image;
    });
  };

  const syncDraftCaptions = (caption: string) => {
    setDrafts((current) =>
      Object.fromEntries(
        platformIds.map((platform) => {
          const draft = current[platform];

          return [
            platform,
            draft.customized
              ? draft
              : {
                  ...draft,
                  caption,
                },
          ];
        }),
      ) as Record<SocialPlatform, SocialPostDraft>,
    );
  };

  const applyCaptionStrategy = (strategy: AiPostContent, notice: string) => {
    setCaptionStrategy(strategy);
    setMasterCaption(strategy.caption);
    setDrafts(createDrafts(strategy.caption));
    setSaveNotice(notice);
  };

  const handleMasterCaptionChange = (caption: string) => {
    setMasterCaption(caption);
    syncDraftCaptions(caption);
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
      });

      replaceImage({
        id: `generated-${Date.now()}-${crypto.randomUUID()}`,
        name: generated.fileName,
        url: generated.imageDataUrl,
        generated: true,
        objectUrl: false,
      });
      setSaveNotice(`Image generated with ${generated.model}.`);
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

  const togglePlatform = (platform: SocialPlatform) => {
    setSelectedPlatforms((current) =>
      current.includes(platform)
        ? current.filter((item) => item !== platform)
        : [...current, platform],
    );
  };

  const toggleSelectAllPlatforms = () => {
    setSelectedPlatforms(selectedAll ? [] : [...platformIds]);
  };

  const updateDraft = (platform: SocialPlatform, patch: Partial<SocialPostDraft>) => {
    setDrafts((current) => ({
      ...current,
      [platform]: {
        ...current[platform],
        ...patch,
      },
    }));
  };

  const handleTweakPlatformCaption = async (platform: SocialPlatform) => {
    const draft = drafts[platform];
    const instruction = draft.tweakInstruction.trim();

    if (!instruction) {
      setSaveNotice(`Add a ${platformById[platform].label} tweak first.`);
      return;
    }

    updateDraft(platform, { isTweaking: true });

    try {
      const generated = await generatePostContent(authToken, {
        prompt: captionPrompt,
        platform,
        currentCaption: draft.caption || masterCaption,
        tweakInstruction: instruction,
        imageNames: postImage ? [postImage.name] : [],
        tags: activeHashtags,
      });

      updateDraft(platform, {
        caption: generated.caption,
        customized: true,
        isTweaking: false,
      });
      setSaveNotice(`${platformById[platform].label} caption tweaked.`);
    } catch (error) {
      updateDraft(platform, { isTweaking: false });
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

  const setScheduledPostUpdating = (postId: string, updating: boolean) => {
    setUpdatingScheduledPostIds((current) =>
      updating
        ? [...new Set([...current, postId])]
        : current.filter((id) => id !== postId),
    );
  };

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

  const handleReschedulePost = async (post: ScheduledSocialPost, date: Date) => {
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
  };

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

  const validateScheduleContent = () => {
    if (!selectedPlatforms.length) {
      setSaveNotice("Select at least one platform before scheduling.");
      return false;
    }

    if (!masterCaption.trim() && !postImage) {
      setSaveNotice("Add a caption or image before scheduling.");
      return false;
    }

    return true;
  };

  const handleOpenSchedule = () => {
    if (!validateScheduleContent()) {
      return;
    }

    const scheduledDate = new Date(scheduleAt);

    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
      setScheduleAt(buildDefaultScheduleValue());
    }

    setIsScheduleModalOpen(true);
  };

  const handlePush = () => {
    setSaveNotice("Immediate publishing is not connected yet. Use Schedule to queue a timed post.");
  };

  const handleScheduleSubmit = async () => {
    const scheduledDate = new Date(scheduleAt);

    if (!validateScheduleContent()) {
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
        posts: selectedPlatforms.map((platform) => ({
          platform,
          caption: (drafts[platform].caption || masterCaption).trim(),
        })),
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
        `${selectedPlatforms.length} platform post${selectedPlatforms.length === 1 ? "" : "s"} scheduled for ${formatScheduledDateTime(scheduledFor, userTimezone)}.`,
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
              Generate caption strategy and portrait creative, then stage the post for
              Facebook, LinkedIn, X/Twitter, and Instagram.
            </p>
          </div>
          <div className="post-hero__pill">Accounts not connected</div>
        </div>

        <div className="post-layout">
          <div className="post-compose">
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
                <button
                  className="post-generate-btn"
                  disabled={isGeneratingImage}
                  onClick={() => void handleGenerateImage()}
                  type="button"
                >
                  {isGeneratingImage ? "Generating..." : "Generate image"}
                </button>
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
                <h2>Select platforms</h2>
              </div>
              <div className="post-platform-selector">
                <button
                  className={`post-platform-btn ${selectedAll ? "post-platform-btn--active" : ""}`}
                  onClick={toggleSelectAllPlatforms}
                  type="button"
                >
                  Select all
                </button>
                {socialPlatforms.map((platform) => (
                  <button
                    aria-pressed={selectedPlatforms.includes(platform.id)}
                    className={`post-platform-btn ${selectedPlatforms.includes(platform.id) ? "post-platform-btn--active" : ""}`}
                    key={platform.id}
                    onClick={() => togglePlatform(platform.id)}
                    type="button"
                  >
                    <span>{platform.shortLabel}</span>
                    {platform.label}
                  </button>
                ))}
              </div>
              <div className="post-field-meta">
                {selectedPlatforms.length} of {platformIds.length} selected
              </div>
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
                disabled={!selectedPlatforms.length || isSchedulingPost}
                onClick={handleOpenSchedule}
                type="button"
              >
                Schedule
              </button>
              <button
                className="post-push-btn"
                disabled={!selectedPlatforms.length}
                onClick={handlePush}
                type="button"
              >
                Push
              </button>
            </div>
          </div>

          {selectedPlatforms.length ? (
            <div className="post-platform-grid">
              {selectedPlatforms.map((platform) => {
                const meta = platformById[platform];
                const draft = drafts[platform];
                const overLimit = draft.caption.length > meta.captionLimit;

                return (
                  <article className="post-platform-card" key={platform}>
                    <div className="post-platform-card__top">
                      <div className="post-platform-card__mark">{meta.shortLabel}</div>
                      <div>
                        <strong>{meta.label}</strong>
                        <span>{meta.previewMeta}</span>
                      </div>
                    </div>

                    {postImage ? (
                      <div className="post-platform-card__image">
                        <img alt={`${meta.label} preview`} src={postImage.url} />
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
                          updateDraft(platform, {
                            caption: event.target.value,
                            customized: true,
                          })
                        }
                        rows={8}
                        value={draft.caption}
                      />
                      <small className={overLimit ? "post-platform-limit--warn" : undefined}>
                        {draft.caption.length}/{meta.captionLimit} recommended
                      </small>
                    </label>

                    <label className="post-platform-tweak">
                      <span>Tweak prompt for {meta.label}</span>
                      <textarea
                        maxLength={2000}
                        onChange={(event) =>
                          updateDraft(platform, {
                            tweakInstruction: event.target.value,
                          })
                        }
                        placeholder={`Example: Make this more ${meta.label}-native without changing the core point.`}
                        rows={3}
                        value={draft.tweakInstruction}
                      />
                    </label>

                    <div className="post-platform-card__actions">
                      <span>{meta.styleHint}</span>
                      <button
                        disabled={draft.isTweaking}
                        onClick={() => void handleTweakPlatformCaption(platform)}
                        type="button"
                      >
                        {draft.isTweaking ? "Tweaking..." : "Tweak caption"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="post-platform-empty">
              Select one or more platforms to see final previews.
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
          <section className="post-calendar-dialog" aria-label="Scheduled social post queue">
            <div className="post-calendar-panel__header">
              <div>
                <span className="eyebrow">Scheduled queue</span>
                <h2 id="post-calendar-title">{queueMonthLabel}</h2>
                <p>
                  {isScheduledQueueLoading
                    ? "Loading shared queue..."
                    : sortedScheduledPosts.length
                    ? `${sortedScheduledPosts.length} scheduled platform post${sortedScheduledPosts.length === 1 ? "" : "s"}`
                    : "No scheduled posts yet"}
                </p>
              </div>
              <div className="post-calendar-actions">
                <button onClick={() => shiftQueueMonth(-1)} type="button">
                  Prev
                </button>
                <button onClick={() => setQueueMonth(new Date())} type="button">
                  Today
                </button>
                <button onClick={() => shiftQueueMonth(1)} type="button">
                  Next
                </button>
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
                    {day.events.slice(0, 3).map((event) => {
                      const meta = platformById[event.platform];

                      return (
                        <article
                          className={[
                            "post-calendar-event",
                            canEditScheduledPost(event) ? "post-calendar-event--editable" : "",
                            updatingScheduledPostIds.includes(event.id) ? "post-calendar-event--updating" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          aria-grabbed={draggedScheduledPostId === event.id}
                          draggable={canEditScheduledPost(event)}
                          onDragEnd={() => setDraggedScheduledPostId(null)}
                          onDragStart={(dragEvent) => handleScheduledPostDragStart(dragEvent, event)}
                          onPointerDown={(pointerEvent) => handleScheduledPostPointerDown(pointerEvent, event)}
                          key={event.id}
                          title={`${meta.label} at ${formatScheduledTime(event.scheduledFor, event.timezone)} - ${event.statusMessage ?? event.status}`}
                        >
                          {event.thumbnailDataUrl ? (
                            <img
                              alt={event.imageName ?? `${meta.label} scheduled image`}
                              draggable={false}
                              src={event.thumbnailDataUrl}
                            />
                          ) : (
                            <span className="post-calendar-event__placeholder">
                              {meta.shortLabel}
                            </span>
                          )}
                          <div className="post-calendar-event__details">
                            <span>
                              {meta.label}
                              {canEditScheduledPost(event) ? (
                                <span className="post-calendar-event__drag-hint">Drag</span>
                              ) : null}
                            </span>
                            <strong>{formatScheduledTime(event.scheduledFor, event.timezone)}</strong>
                            <small>{event.status.replace(/_/g, " ")}</small>
                          </div>
                          <div className="post-calendar-event__controls">
                            <input
                              aria-label={`Move ${meta.label} post date`}
                              disabled={!canEditScheduledPost(event) || updatingScheduledPostIds.includes(event.id)}
                              min={formatDateInputValue(new Date())}
                              onChange={(changeEvent) => {
                                const nextDate = mergeDateWithPostTime(
                                  new Date(`${changeEvent.target.value}T00:00`),
                                  event,
                                );

                                if (!Number.isNaN(nextDate.getTime())) {
                                  void handleReschedulePost(event, nextDate);
                                }
                              }}
                              type="date"
                              value={formatDateInputValue(new Date(event.scheduledFor))}
                            />
                            <input
                              aria-label={`Move ${meta.label} post time`}
                              disabled={!canEditScheduledPost(event) || updatingScheduledPostIds.includes(event.id)}
                              onChange={(changeEvent) => {
                                const nextDate = mergePostDateWithTime(event, changeEvent.target.value);

                                if (!Number.isNaN(nextDate.getTime())) {
                                  void handleReschedulePost(event, nextDate);
                                }
                              }}
                              type="time"
                              value={formatTimeInputValue(new Date(event.scheduledFor))}
                            />
                            <button
                              disabled={!canEditScheduledPost(event) || updatingScheduledPostIds.includes(event.id)}
                              onClick={() => void handleRemoveScheduledPost(event)}
                              type="button"
                            >
                              Remove
                            </button>
                          </div>
                        </article>
                      );
                    })}
                    {day.events.length > 3 ? (
                      <span className="post-calendar-more">+{day.events.length - 3} more</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            {draggedScheduledPost && scheduledDragPoint ? (
              <div
                className="post-calendar-drag-ghost"
                style={{
                  transform: `translate(${scheduledDragPoint.x + 12}px, ${scheduledDragPoint.y + 12}px)`,
                }}
              >
                <span>{platformById[draggedScheduledPost.platform].label}</span>
                <strong>{formatScheduledTime(draggedScheduledPost.scheduledFor, draggedScheduledPost.timezone)}</strong>
              </div>
            ) : null}

            <p className="post-calendar-note">
              Times use {userTimezone}. The queue is shared with every OpsUI member.
            </p>
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
                <span>Platforms</span>
                <strong>{selectedPlatforms.length} selected</strong>
              </div>
              <div>
                <span>Timezone</span>
                <strong>{userTimezone}</strong>
              </div>
            </div>

            <div className="post-schedule-platform-row">
              {selectedPlatforms.map((platform) => (
                <span key={platform}>{platformById[platform].label}</span>
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
              time arrives, the server will attempt to send them through the connected
              publishing service.
            </p>
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

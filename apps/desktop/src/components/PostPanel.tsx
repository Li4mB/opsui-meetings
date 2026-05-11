import { useEffect, useMemo, useRef, useState } from "react";
import opsLogo from "../assets/op.png";
import { generatePostContent, generatePostImage } from "../lib/api";

type PostImage = {
  id: string;
  name: string;
  url: string;
  generated: boolean;
};

type Props = {
  authToken: string;
};

const defaultTags = ["opsui", "meetings", "demo"];
const stopWords = new Set([
  "about",
  "after",
  "and",
  "before",
  "better",
  "cleaner",
  "create",
  "demo",
  "from",
  "into",
  "meeting",
  "meetings",
  "post",
  "social",
  "stronger",
  "team",
  "that",
  "the",
  "this",
  "with",
]);

const buildImageId = (file: File) =>
  `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`;

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 42) || "opsui-post";

const escapeSvgText = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const extractTags = (value: string) => {
  const words = value
    .toLowerCase()
    .match(/[a-z][a-z0-9-]{2,}/g) ?? [];

  return [
    "opsui",
    ...words.filter((word) => !stopWords.has(word)),
    "content",
  ].filter((tag, index, allTags) => allTags.indexOf(tag) === index).slice(0, 8);
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

  return lines.slice(0, 5);
};

const humanizeTag = (tag: string) =>
  tag.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const buildPosterCopy = (input: { tags: string[]; imageCount: number }) => {
  const tagSet = new Set(input.tags);

  if (tagSet.has("productivity") || tagSet.has("software")) {
    return {
      headline: "Meetings, sharpened.",
      subhead: "Premium workspace clarity for modern teams.",
      detail: "Plan. Align. Follow through.",
    };
  }

  if (tagSet.has("handover") || tagSet.has("handovers")) {
    return {
      headline: "Cleaner handovers.",
      subhead: "Every meeting detail ready before the next move.",
      detail: "Prep that keeps momentum alive.",
    };
  }

  if (input.imageCount > 0) {
    return {
      headline: "Built for the moment.",
      subhead: "Visual context, meeting prep, and next steps in one place.",
      detail: "OpsUI Meetings",
    };
  }

  return {
    headline: "Meetings made clear.",
    subhead: "A calmer way to prep, run, and follow up.",
    detail: "OpsUI Meetings",
  };
};

const isCrmPipelinePrompt = (value: string) => {
  const normalized = value.toLowerCase();

  return (
    normalized.includes("pipeline") &&
    normalized.includes("crm")
  );
};

const buildCrmPipelinePosterSvg = () =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">`,
    `<defs>`,
    `<radialGradient id="purpleGlow" cx="72%" cy="26%" r="64%"><stop offset="0%" stop-color="#7B5CFF" stop-opacity="0.34"/><stop offset="100%" stop-color="#7B5CFF" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="redGlow" cx="78%" cy="68%" r="58%"><stop offset="0%" stop-color="#ff304d" stop-opacity="0.2"/><stop offset="100%" stop-color="#ff304d" stop-opacity="0"/></radialGradient>`,
    `<pattern id="grid" width="42" height="42" patternUnits="userSpaceOnUse"><path d="M42 0H0V42" fill="none" stroke="#ffffff" stroke-opacity="0.045" stroke-width="1"/></pattern>`,
    `<filter id="fakeGlow"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
    `</defs>`,
    `<rect width="1200" height="900" fill="#0A0A0F"/>`,
    `<rect width="1200" height="900" fill="url(#grid)" opacity="0.42"/>`,
    `<rect width="1200" height="900" fill="url(#purpleGlow)"/>`,
    `<rect width="1200" height="900" fill="url(#redGlow)"/>`,
    `<text x="72" y="104" fill="#8b8da3" font-family="Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="6">CRM REALITY CHECK</text>`,
    `<text x="72" y="194" fill="#ffffff" font-family="Arial Black, Arial, sans-serif" font-size="70" font-weight="900">YOUR PIPELINE IS</text>`,
    `<text x="72" y="280" fill="#7B5CFF" filter="url(#fakeGlow)" font-family="Arial Black, Arial, sans-serif" font-size="96" font-weight="900">PROBABLY FAKE.</text>`,
    `<text x="76" y="336" fill="#d6d8e8" font-family="Arial, sans-serif" font-size="27">Your CRM shows what people say.</text>`,
    `<text x="76" y="374" fill="#d6d8e8" font-family="Arial, sans-serif" font-size="27">Not what's actually happening.</text>`,
    `<rect x="70" y="438" width="505" height="344" rx="24" fill="#11141a" stroke="#2ee77b" stroke-opacity="0.34"/>`,
    `<rect x="625" y="438" width="505" height="344" rx="24" fill="#141014" stroke="#ff385a" stroke-opacity="0.42"/>`,
    `<text x="104" y="488" fill="#2ee77b" font-family="Arial, sans-serif" font-size="22" font-weight="800" letter-spacing="3">CRM VIEW</text>`,
    `<text x="659" y="488" fill="#ff536d" font-family="Arial, sans-serif" font-size="22" font-weight="800" letter-spacing="3">REALITY</text>`,
    `<rect x="104" y="522" width="424" height="58" rx="14" fill="#151d19" stroke="#2ee77b" stroke-opacity="0.22"/>`,
    `<circle cx="134" cy="551" r="12" fill="#2ee77b"/><path d="M128 551l5 5 9-11" stroke="#06110a" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<text x="166" y="545" fill="#ffffff" font-family="Arial, sans-serif" font-size="20" font-weight="700">Deal: Closing this week</text>`,
    `<text x="166" y="568" fill="#8ea79a" font-family="Arial, sans-serif" font-size="15">High confidence</text>`,
    `<rect x="104" y="604" width="424" height="58" rx="14" fill="#151d19" stroke="#2ee77b" stroke-opacity="0.18"/>`,
    `<circle cx="134" cy="633" r="12" fill="#2ee77b"/><path d="M128 633l5 5 9-11" stroke="#06110a" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<text x="166" y="627" fill="#ffffff" font-family="Arial, sans-serif" font-size="20" font-weight="700">Lead: Hot</text>`,
    `<text x="166" y="650" fill="#8ea79a" font-family="Arial, sans-serif" font-size="15">Priority account</text>`,
    `<rect x="104" y="686" width="424" height="58" rx="14" fill="#151d19" stroke="#2ee77b" stroke-opacity="0.18"/>`,
    `<circle cx="134" cy="715" r="12" fill="#2ee77b"/><path d="M128 715l5 5 9-11" stroke="#06110a" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<text x="166" y="709" fill="#ffffff" font-family="Arial, sans-serif" font-size="20" font-weight="700">Follow-up: Done</text>`,
    `<text x="166" y="732" fill="#8ea79a" font-family="Arial, sans-serif" font-size="15">Activity complete</text>`,
    `<rect x="659" y="522" width="424" height="58" rx="14" fill="#201116" stroke="#ff385a" stroke-opacity="0.26"/>`,
    `<text x="690" y="558" fill="#ff536d" font-family="Arial, sans-serif" font-size="26" font-weight="900">!</text>`,
    `<text x="730" y="545" fill="#ffffff" font-family="Arial, sans-serif" font-size="20" font-weight="700">No reply in 5 days</text>`,
    `<text x="730" y="568" fill="#b78e98" font-family="Arial, sans-serif" font-size="15">Deal risk rising</text>`,
    `<rect x="659" y="604" width="424" height="58" rx="14" fill="#201116" stroke="#ff385a" stroke-opacity="0.22"/>`,
    `<text x="690" y="640" fill="#ff536d" font-family="Arial, sans-serif" font-size="26" font-weight="900">!</text>`,
    `<text x="730" y="627" fill="#ffffff" font-family="Arial, sans-serif" font-size="20" font-weight="700">Lead has gone cold</text>`,
    `<text x="730" y="650" fill="#b78e98" font-family="Arial, sans-serif" font-size="15">No buying signal</text>`,
    `<rect x="659" y="686" width="424" height="58" rx="14" fill="#201116" stroke="#ff385a" stroke-opacity="0.22"/>`,
    `<text x="690" y="722" fill="#ff536d" font-family="Arial, sans-serif" font-size="26" font-weight="900">!</text>`,
    `<text x="730" y="709" fill="#ffffff" font-family="Arial, sans-serif" font-size="20" font-weight="700">Follow-up opened, not read</text>`,
    `<text x="730" y="732" fill="#b78e98" font-family="Arial, sans-serif" font-size="15">Activity logged, intent missing</text>`,
    `<line x1="600" y1="438" x2="600" y2="782" stroke="#7B5CFF" stroke-opacity="0.24" stroke-width="2"/>`,
    `<text x="72" y="840" fill="#7B5CFF" font-family="Arial, sans-serif" font-size="20" font-weight="800">OPSUI PIPELINE INTELLIGENCE</text>`,
    `</svg>`,
  ].join("");

const buildOptimizedCaption = (input: {
  prompt: string;
  tags: string[];
  imageCount: number;
  variant: number;
}) => {
  const focusTags = input.tags.filter((tag) => tag !== "opsui").slice(0, 3);
  const primaryFocus = focusTags[0] ? humanizeTag(focusTags[0]) : "Meeting prep";
  const secondaryFocus = focusTags[1] ? humanizeTag(focusTags[1]) : "handover clarity";
  const visualLines = [
    input.imageCount > 0
      ? `The visuals bring the story into focus: ${primaryFocus.toLowerCase()}, ${secondaryFocus.toLowerCase()}, and cleaner follow-through.`
      : `This update is about ${primaryFocus.toLowerCase()}, ${secondaryFocus.toLowerCase()}, and making every next step easier to action.`,
    input.imageCount > 0
      ? `A sharp visual system helps turn scattered prep into a post-ready story.`
      : `Small improvements before the call can make the whole handover feel calmer after it.`,
    input.imageCount > 0
      ? `The generated creative gives the post a stronger first impression while keeping the message focused.`
      : `Use the prompt as direction, then let the caption speak like a finished brand update.`,
  ];
  const templates = [
    [
      `${primaryFocus} works best when every detail is clear before the conversation starts.`,
      visualLines[input.variant % visualLines.length],
      "OpsUI Meetings keeps the team aligned from prep to handover, so each demo feels sharper, faster, and easier to follow through.",
      "What should we show next?",
    ],
    [
      `Great meetings are not accidental. They start with clear context, strong ownership, and less last-minute guesswork.`,
      `${primaryFocus} and ${secondaryFocus.toLowerCase()} stay front and center, so the team can move from conversation to action with confidence.`,
      "That is the kind of workflow OpsUI is building for modern teams.",
    ],
    [
      `A polished meeting workflow should feel quiet, fast, and ready before anyone joins the call.`,
      visualLines[(input.variant + 1) % visualLines.length],
      `OpsUI Meetings helps turn ${primaryFocus.toLowerCase()} into a repeatable rhythm, not another admin task.`,
    ],
    [
      `Less chasing. More clarity. Better meetings.`,
      `This post highlights ${primaryFocus.toLowerCase()} with a focus on ${secondaryFocus.toLowerCase()}, built for teams that want every follow-up to land cleanly.`,
      "Prepared context makes the whole customer conversation feel more intentional.",
    ],
  ];

  return templates[input.variant % templates.length].join("\n\n");
};

export const PostPanel = ({ authToken }: Props) => {
  const [prompt, setPrompt] = useState(
    "Create a polished social post about the OpsUI team preparing better meetings, cleaner handovers, and stronger demo follow-up.",
  );
  const [caption, setCaption] = useState(
    "Behind the scenes with the OpsUI team: focused calls, cleaner handovers, and better meeting prep.",
  );
  const [images, setImages] = useState<PostImage[]>([]);
  const imagesRef = useRef<PostImage[]>([]);
  const captionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const captionVariantRef = useRef(0);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>(defaultTags);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  const normalizedCaption = caption.trim();
  const postCaption = normalizedCaption || "Write a caption to preview it here.";
  const postTags = tags.map((tag) => `#${tag}`).join(" ");
  const promptCount = prompt.length;
  const captionCount = caption.length;
  const hasImages = images.length > 0;

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

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    return () => {
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.url));
    };
  }, []);

  useEffect(() => {
    if (!saveNotice) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setSaveNotice(null);
    }, 3600);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [saveNotice]);

  useEffect(() => {
    const captionInput = captionInputRef.current;

    if (!captionInput) {
      return;
    }

    captionInput.style.height = "auto";
    captionInput.style.height = `${captionInput.scrollHeight}px`;
  }, [caption]);

  const addTag = (value: string) => {
    const nextTag = value.trim().replace(/^#/, "").toLowerCase();

    if (!nextTag || tags.includes(nextTag)) {
      return;
    }

    setTags((current) => [...current, nextTag]);
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    setTags((current) => current.filter((item) => item !== tag));
  };

  const mergeTags = (nextTags: string[]) => {
    setTags((current) =>
      [...current, ...nextTags].filter(
        (tag, index, allTags) => tag && allTags.indexOf(tag) === index,
      ),
    );
  };

  const handleGenerateCaption = async () => {
    const source = prompt.trim() || caption.trim();
    const nextTags = extractTags(source);

    setIsGeneratingCaption(true);

    try {
      const generated = await generatePostContent(authToken, {
        prompt: source,
        currentCaption: caption,
        imageNames: images.map((image) => image.name),
        tags,
      });

      setCaption(generated.caption);
      mergeTags(generated.tags);
      setSaveNotice("Caption generated with ChatGPT.");
    } catch {
      captionVariantRef.current += 1;
      const variant = captionVariantRef.current + Math.floor(Math.random() * 4);
      const generatedCaption = buildOptimizedCaption({
        prompt: source,
        tags: nextTags,
        imageCount: images.length,
        variant,
      });

      setCaption(generatedCaption);
      mergeTags(nextTags);
      setSaveNotice("ChatGPT unavailable. Used local caption fallback.");
    } finally {
      setIsGeneratingCaption(false);
    }
  };

  const buildLocalGeneratedImage = (source: string, nextTags: string[]): PostImage => {
    const imageName = `${slugify(source)}-${images.length + 1}.svg`;
    const svg = isCrmPipelinePrompt(source)
      ? buildCrmPipelinePosterSvg()
      : (() => {
    const posterCopy = buildPosterCopy({
      tags: nextTags,
      imageCount: images.length,
    });
    const titleLines = wrapText(posterCopy.headline, 22);
    const subheadLines = wrapText(posterCopy.subhead, 42);
    const base = "#080807";
    const panel = "#17130d";
    const accent = "#d6ad2d";
    const accentSoft = "#f3d977";
    const text = "#fff6d8";
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">`,
      `<rect width="1200" height="900" fill="${base}"/>`,
      `<rect x="0" y="0" width="1200" height="900" fill="url(#grid)" opacity="0.18"/>`,
      `<defs>`,
      `<radialGradient id="glowA" cx="72%" cy="18%" r="58%"><stop offset="0%" stop-color="${accent}" stop-opacity="0.28"/><stop offset="100%" stop-color="${accent}" stop-opacity="0"/></radialGradient>`,
      `<radialGradient id="glowB" cx="20%" cy="86%" r="56%"><stop offset="0%" stop-color="${accentSoft}" stop-opacity="0.12"/><stop offset="100%" stop-color="${accentSoft}" stop-opacity="0"/></radialGradient>`,
      `<pattern id="grid" width="54" height="54" patternUnits="userSpaceOnUse"><path d="M 54 0 L 0 0 0 54" fill="none" stroke="#ffffff" stroke-opacity="0.055" stroke-width="1"/></pattern>`,
      `</defs>`,
      `<rect width="1200" height="900" fill="url(#glowA)"/>`,
      `<rect width="1200" height="900" fill="url(#glowB)"/>`,
      `<rect x="72" y="72" width="1056" height="756" rx="38" fill="${panel}" fill-opacity="0.72" stroke="${accent}" stroke-opacity="0.28"/>`,
      `<rect x="760" y="170" width="260" height="410" rx="28" fill="#0d0d0b" stroke="${accent}" stroke-opacity="0.16"/>`,
      `<rect x="796" y="218" width="188" height="18" rx="9" fill="${accent}" opacity="0.72"/>`,
      `<rect x="796" y="276" width="154" height="14" rx="7" fill="#ffffff" opacity="0.14"/>`,
      `<rect x="796" y="318" width="182" height="14" rx="7" fill="#ffffff" opacity="0.1"/>`,
      `<rect x="796" y="390" width="92" height="92" rx="18" fill="${accent}" opacity="0.2"/>`,
      `<rect x="906" y="390" width="92" height="92" rx="18" fill="${accent}" opacity="0.12"/>`,
      `<text x="112" y="146" fill="${accent}" font-family="Arial, sans-serif" font-size="26" font-weight="700" letter-spacing="6">OPSUI</text>`,
      ...titleLines.map(
        (line, index) =>
          `<text x="112" y="${322 + index * 74}" fill="${text}" font-family="Arial, sans-serif" font-size="70" font-weight="800">${escapeSvgText(line)}</text>`,
      ),
      ...subheadLines.map(
        (line, index) =>
          `<text x="116" y="${520 + index * 42}" fill="#d6d0c2" font-family="Arial, sans-serif" font-size="30" font-weight="500">${escapeSvgText(line)}</text>`,
      ),
      `<text x="116" y="714" fill="${accent}" font-family="Arial, sans-serif" font-size="24" font-weight="700">${escapeSvgText(posterCopy.detail)}</text>`,
      `<text x="116" y="768" fill="#d6d0c2" opacity="0.72" font-family="Arial, sans-serif" font-size="22">${escapeSvgText(nextTags.slice(0, 5).map((tag) => `#${tag}`).join(" "))}</text>`,
      `</svg>`,
    ].join("");
      })();
    return {
      id: `generated-${Date.now()}-${crypto.randomUUID()}`,
      name: imageName,
      url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })),
      generated: true,
    };
  };

  const handleGenerateImage = async () => {
    const source = prompt.trim() || caption.trim() || "OpsUI Meetings content";
    const nextTags = extractTags(source);

    setIsGeneratingImage(true);

    try {
      const generated = await generatePostImage(authToken, {
        prompt: source,
        caption,
        tags,
      });
      const image = {
        id: `generated-${Date.now()}-${crypto.randomUUID()}`,
        name: generated.fileName,
        url: generated.imageDataUrl,
        generated: true,
      };

      setImages((current) => [...current, image].slice(0, 6));
      mergeTags(generated.tags);
      setSaveNotice("Image generated with ChatGPT.");
    } catch {
      const image = buildLocalGeneratedImage(source, nextTags);

      setImages((current) => [...current, image].slice(0, 6));
      mergeTags(nextTags);
      setSaveNotice("ChatGPT unavailable. Used local image fallback.");
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const saveGeneratedImage = async (image: PostImage) => {
    try {
      const loadedImage = new Image();
      const jpegName = image.name.replace(/\.[^.]+$/, ".jpg");
      const jpegUrl = await new Promise<string>((resolve, reject) => {
        loadedImage.onload = () => {
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");

          if (!context) {
            reject(new Error("Unable to create image export."));
            return;
          }

          canvas.width = loadedImage.naturalWidth || 1200;
          canvas.height = loadedImage.naturalHeight || 900;
          context.fillStyle = "#080807";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(loadedImage, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.94));
        };
        loadedImage.onerror = () => reject(new Error("Unable to load generated image."));
        loadedImage.src = image.url;
      });
      const anchor = document.createElement("a");

      anchor.href = jpegUrl;
      anchor.download = jpegName;
      anchor.click();
      setSaveNotice("Image saved to Downloads!");
    } catch {
      setSaveNotice("Image could not be saved.");
    }
  };

  const handleImageUpload = (files: FileList | null) => {
    if (!files?.length) {
      return;
    }

    const nextImages = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .map((file) => ({
        id: buildImageId(file),
        name: file.name,
        url: URL.createObjectURL(file),
        generated: false,
      }));

    setImages((current) => [...current, ...nextImages].slice(0, 6));
  };

  const removeImage = (imageId: string) => {
    setImages((current) => {
      const image = current.find((item) => item.id === imageId);

      if (image) {
        URL.revokeObjectURL(image.url);
      }

      return current.filter((item) => item.id !== imageId);
    });
  };

  return (
    <section className="post-shell">
      <div className="post-card">
        <div className="post-card__hero">
          <div>
            <div className="sidebar-section__label">Create Content</div>
            <h1 className="post-title">Build a post before it goes live</h1>
            <p className="post-subtitle">
              Build the prompt, images, and tags on the left. Edit the live caption on
              the right to shape the final post before it is shared.
            </p>
          </div>
          <div className="post-hero__pill">Live post preview</div>
        </div>

        <div className="post-layout">
          <div className="post-compose">
            <section className="post-section">
              <div className="post-section__header">
                <span className="eyebrow">Prompt</span>
                <h2>Guide the caption</h2>
              </div>
              <label>
                Prompt
                <textarea
                  className="post-caption-input"
                  maxLength={4000}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Describe what the caption should say, tone, audience, and key points..."
                  rows={8}
                  value={prompt}
                />
              </label>
              <div className="post-section-actions">
                <button
                  className="post-generate-btn"
                  disabled={isGeneratingCaption}
                  onClick={() => void handleGenerateCaption()}
                  type="button"
                >
                  {isGeneratingCaption ? "Generating..." : "Generate caption and tags"}
                </button>
                <span className="post-field-meta">{promptCount}/4000 prompt characters</span>
              </div>
            </section>

            <section className="post-section">
              <div className="post-section__header">
                <span className="eyebrow">Images</span>
                <h2>Add visuals</h2>
              </div>

              <label className="post-upload">
                <span className="post-upload__icon">+</span>
                <span>
                  <strong>Upload images</strong>
                  <small>PNG, JPG, or WEBP. Up to 6 images.</small>
                </span>
                <input
                  accept="image/*"
                  multiple
                  onChange={(event) => handleImageUpload(event.target.files)}
                  type="file"
                />
              </label>

              <button
                className="post-generate-btn post-generate-btn--wide"
                disabled={isGeneratingImage}
                onClick={() => void handleGenerateImage()}
                type="button"
              >
                {isGeneratingImage ? "Generating image..." : "Generate image from prompt"}
              </button>

              {hasImages ? (
                <div className="post-image-list">
                  {images.map((image) => (
                    <div className="post-image-item" key={image.id}>
                      <img alt="" src={image.url} />
                      <span>{image.name}</span>
                      <div className="post-image-item__actions">
                        {image.generated ? (
                          <button
                            className="post-image-item__save"
                            onClick={() => void saveGeneratedImage(image)}
                            type="button"
                          >
                            Save
                          </button>
                        ) : null}
                        <button
                          className="post-image-item__remove"
                          onClick={() => removeImage(image.id)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="post-section">
              <div className="post-section__header">
                <span className="eyebrow">Tags</span>
                <h2>Group the content</h2>
              </div>
              <label>
                Tags
                <input
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      addTag(tagInput);
                    }
                  }}
                  placeholder="Type a tag and press Enter"
                  value={tagInput}
                />
              </label>
              <div className="post-tag-row">
                {tags.map((tag) => (
                  <button
                    className="post-tag-chip"
                    key={tag}
                    onClick={() => removeTag(tag)}
                    type="button"
                  >
                    #{tag}
                    <span>x</span>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <aside className="post-preview-panel" aria-label="Live post preview">
            <div className="post-preview-panel__header">
              <span className="eyebrow">Live</span>
              <h2>Post preview</h2>
            </div>

            <article className="post-preview">
              <div className="post-preview__top">
                <img alt="OpsUI" className="post-preview__avatar" src={opsLogo} />
                <div>
                  <strong>OpsUI Meetings</strong>
                  <span>{previewTime}</span>
                </div>
              </div>

              <label className="post-preview__caption-editor">
                <span>Caption</span>
                <textarea
                  ref={captionInputRef}
                  className="post-preview__caption-input"
                  maxLength={2200}
                  onChange={(event) => setCaption(event.target.value)}
                  placeholder="Edit the final caption here..."
                  rows={4}
                  value={caption}
                />
                <small>{captionCount}/2200 characters</small>
              </label>

              {!normalizedCaption ? (
                <p className="post-preview__caption-placeholder">{postCaption}</p>
              ) : null}

              {hasImages ? (
                <div
                  className={`post-preview__images post-preview__images--${Math.min(images.length, 4)}`}
                >
                  {images.slice(0, 4).map((image, index) => (
                    <div className="post-preview__image" key={image.id}>
                      <img alt={`Post preview ${index + 1}`} src={image.url} />
                      {index === 3 && images.length > 4 ? (
                        <span className="post-preview__more">+{images.length - 4}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="post-preview__empty-image">Image preview</div>
              )}

              {postTags ? <div className="post-preview__tags">{postTags}</div> : null}

              <div className="post-preview__metrics">
                <span>Ready to post</span>
                <span>{images.length} image{images.length === 1 ? "" : "s"}</span>
                <span>{tags.length} tag{tags.length === 1 ? "" : "s"}</span>
              </div>
            </article>
          </aside>
        </div>
      </div>
      {saveNotice ? (
        <div className="post-save-toast" role="status" aria-live="polite">
          {saveNotice}
        </div>
      ) : null}
    </section>
  );
};

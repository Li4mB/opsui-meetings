import { useEffect, useMemo, useRef, useState } from "react";
import opsLogo from "../assets/op.png";

type PostImage = {
  id: string;
  name: string;
  url: string;
  generated: boolean;
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

export const PostPanel = () => {
  const [prompt, setPrompt] = useState(
    "Create a polished social post about the OpsUI team preparing better meetings, cleaner handovers, and stronger demo follow-up.",
  );
  const [caption, setCaption] = useState(
    "Behind the scenes with the OpsUI team: focused calls, cleaner handovers, and better meeting prep.",
  );
  const [images, setImages] = useState<PostImage[]>([]);
  const imagesRef = useRef<PostImage[]>([]);
  const captionVariantRef = useRef(0);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>(defaultTags);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

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

  const handleGenerateCaption = () => {
    const source = prompt.trim() || caption.trim();
    const nextTags = extractTags(source);
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
  };

  const handleGenerateImage = () => {
    const source = prompt.trim() || caption.trim() || "OpsUI Meetings content";
    const nextTags = extractTags(source);
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
    const imageName = `${slugify(source)}-${images.length + 1}.svg`;
    const svg = [
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
    const image = {
      id: `generated-${Date.now()}-${crypto.randomUUID()}`,
      name: imageName,
      url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })),
      generated: true,
    };

    setImages((current) => [...current, image].slice(0, 6));
    mergeTags(nextTags);
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
                  maxLength={1200}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Describe what the caption should say, tone, audience, and key points..."
                  rows={8}
                  value={prompt}
                />
              </label>
              <div className="post-section-actions">
                <button
                  className="post-generate-btn"
                  onClick={handleGenerateCaption}
                  type="button"
                >
                  Generate caption and tags
                </button>
                <span className="post-field-meta">{promptCount}/1200 prompt characters</span>
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
                onClick={handleGenerateImage}
                type="button"
              >
                Generate image from prompt
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

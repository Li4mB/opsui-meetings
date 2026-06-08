import { env } from "../config/env.js";
import { storage } from "../db/database.js";
import type {
  DbScheduledSocialPostWithCreatorRow,
  DbSocialAccountWithCreatorRow,
} from "../db/adapter.js";
import type { DbSocialPlatform } from "../types.js";

type PublishResult = {
  status: "published" | "failed" | "connection_required";
  message: string;
  externalPostId?: string;
};

type PublishOptions = {
  publicBaseUrl?: string;
};

type SocialAccountConfig = {
  id: string;
  platform: DbSocialPlatform;
  displayName: string;
  accountId: string;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  expiresAt: string | null;
  source: "database" | "environment";
  createdByUserId: string | null;
  createdByUserName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type ParsedDataUrl = {
  buffer: Buffer;
  mimeType: string;
};

const socialPlatformOrder: DbSocialPlatform[] = [
  "facebook",
  "instagram",
  "linkedin",
  "twitter",
];

const platformLabels: Record<DbSocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  twitter: "X/Twitter",
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const readJsonResponse = async (response: Response) => {
  const text = await response.text();

  try {
    return {
      payload: text ? (JSON.parse(text) as Record<string, unknown>) : null,
      text,
    };
  } catch {
    return { payload: null, text };
  }
};

const getNestedString = (
  value: Record<string, unknown> | null,
  path: string[],
): string | null => {
  let current: unknown = value;

  for (const key of path) {
    if (
      typeof current !== "object" ||
      current === null ||
      !(key in current)
    ) {
      return null;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" ? current : null;
};

const getResponseErrorMessage = (
  payload: Record<string, unknown> | null,
  text: string,
  fallback: string,
) =>
  getNestedString(payload, ["error", "message"]) ??
  getNestedString(payload, ["message"]) ??
  getNestedString(payload, ["detail"]) ??
  (text || fallback);

const assertResponseOk = async (response: Response, fallback: string) => {
  const { payload, text } = await readJsonResponse(response);

  if (!response.ok) {
    const error = new Error(
      getResponseErrorMessage(payload, text, fallback),
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return payload;
};

export const parseDataUrl = (dataUrl: string): ParsedDataUrl => {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);

  if (!match) {
    throw new Error("Post image must be a valid data URL.");
  }

  const [, mimeType, base64Flag, data] = match;

  return {
    buffer: base64Flag
      ? Buffer.from(data, "base64")
      : Buffer.from(decodeURIComponent(data), "utf8"),
    mimeType: mimeType.toLowerCase(),
  };
};

const parsePostImage = (
  post: DbScheduledSocialPostWithCreatorRow,
): ParsedDataUrl | null => (post.image_data_url ? parseDataUrl(post.image_data_url) : null);

const assertRasterImage = (
  image: ParsedDataUrl,
  platform: DbSocialPlatform,
  supportedMimeTypes: string[],
) => {
  if (!supportedMimeTypes.includes(image.mimeType)) {
    throw new Error(
      `${platformLabels[platform]} publishing supports ${supportedMimeTypes
        .map((mimeType) => mimeType.replace("image/", "").toUpperCase())
        .join(", ")} images from OpsUI.`,
    );
  }
};

const getPublicBaseUrl = (options: PublishOptions) =>
  trimTrailingSlash(options.publicBaseUrl || env.socialPublicApiUrl);

const buildPostImageUrl = (
  post: DbScheduledSocialPostWithCreatorRow,
  options: PublishOptions,
) => {
  const publicBaseUrl = getPublicBaseUrl(options);

  if (!publicBaseUrl) {
    throw new Error(
      "Set OPSUI_PUBLIC_API_URL to publish this platform with an image.",
    );
  }

  const hostname = new URL(publicBaseUrl).hostname;

  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    throw new Error(
      "Set OPSUI_PUBLIC_API_URL to a public HTTPS API URL before publishing Instagram images.",
    );
  }

  return `${publicBaseUrl}/social-posts/assets/${encodeURIComponent(post.id)}/image`;
};

const parseRefreshTokenFromMetadata = (metadataJson: string): string | null => {
  try {
    const metadata = JSON.parse(metadataJson) as { refreshToken?: unknown };
    return typeof metadata.refreshToken === "string" && metadata.refreshToken
      ? metadata.refreshToken
      : null;
  } catch {
    return null;
  }
};

const toDatabaseAccountConfig = (
  row: DbSocialAccountWithCreatorRow,
): SocialAccountConfig => ({
  id: row.id,
  platform: row.platform,
  displayName: row.display_name,
  accountId: row.account_id,
  accessToken: row.access_token,
  refreshToken: parseRefreshTokenFromMetadata(row.metadata_json),
  tokenType: row.token_type,
  expiresAt: row.expires_at,
  source: "database",
  createdByUserId: row.created_by_user_id,
  createdByUserName: row.created_by_user_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const buildEnvironmentAccounts = (): SocialAccountConfig[] => {
  const now = new Date().toISOString();
  const accounts: SocialAccountConfig[] = [];

  if (env.facebookPageId && env.facebookPageAccessToken) {
    accounts.push({
      id: "env-facebook",
      platform: "facebook",
      displayName: "Facebook Page",
      accountId: env.facebookPageId,
      accessToken: env.facebookPageAccessToken,
      refreshToken: null,
      tokenType: "Bearer",
      expiresAt: null,
      source: "environment",
      createdByUserId: null,
      createdByUserName: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (env.instagramUserId && env.instagramAccessToken) {
    accounts.push({
      id: "env-instagram",
      platform: "instagram",
      displayName: "Instagram Account",
      accountId: env.instagramUserId,
      accessToken: env.instagramAccessToken,
      refreshToken: null,
      tokenType: "Bearer",
      expiresAt: null,
      source: "environment",
      createdByUserId: null,
      createdByUserName: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (env.linkedinAuthorUrn && env.linkedinAccessToken) {
    accounts.push({
      id: "env-linkedin",
      platform: "linkedin",
      displayName: "LinkedIn Account",
      accountId: env.linkedinAuthorUrn,
      accessToken: env.linkedinAccessToken,
      refreshToken: null,
      tokenType: "Bearer",
      expiresAt: null,
      source: "environment",
      createdByUserId: null,
      createdByUserName: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (env.xAccessToken) {
    accounts.push({
      id: "env-twitter",
      platform: "twitter",
      displayName: "X Account",
      accountId: env.xAccountId || "authenticated-user",
      accessToken: env.xAccessToken,
      refreshToken: null,
      tokenType: "Bearer",
      expiresAt: null,
      source: "environment",
      createdByUserId: null,
      createdByUserName: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  return accounts;
};

export const listConfiguredSocialAccounts = async () => {
  const databaseAccounts = (await storage.listSocialAccounts()).map(
    toDatabaseAccountConfig,
  );
  const databasePlatforms = new Set(
    databaseAccounts.map((account) => account.platform),
  );
  // Environment accounts are a fallback only for platforms with no connected
  // database account. Database platforms may now hold multiple accounts.
  const environmentAccounts = buildEnvironmentAccounts().filter(
    (account) => !databasePlatforms.has(account.platform),
  );

  return [...databaseAccounts, ...environmentAccounts].sort(
    (a, b) =>
      socialPlatformOrder.indexOf(a.platform) -
        socialPlatformOrder.indexOf(b.platform) ||
      (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
  );
};

const findConfiguredAccount = async (platform: DbSocialPlatform) => {
  const databaseAccount = await storage.findSocialAccountByPlatform(platform);

  if (databaseAccount) {
    return toDatabaseAccountConfig(databaseAccount);
  }

  return (
    buildEnvironmentAccounts().find((account) => account.platform === platform) ??
    null
  );
};

// Resolve the exact account a scheduled post targets. Newer posts carry an
// account_id; legacy posts (account_id null) fall back to the first connected
// account for the platform, preserving previous behaviour.
const resolveAccountForPost = async (
  post: DbScheduledSocialPostWithCreatorRow,
): Promise<SocialAccountConfig | null> => {
  if (post.account_id) {
    const databaseAccount = await storage.findSocialAccountById(post.account_id);

    if (databaseAccount) {
      return toDatabaseAccountConfig(databaseAccount);
    }

    const environmentAccount = buildEnvironmentAccounts().find(
      (account) => account.id === post.account_id,
    );

    if (environmentAccount) {
      return environmentAccount;
    }
  }

  return findConfiguredAccount(post.platform);
};

const publishFacebook = async (
  post: DbScheduledSocialPostWithCreatorRow,
  account: SocialAccountConfig,
) => {
  const image = parsePostImage(post);
  const endpoint = image ? "photos" : "feed";
  const url = `https://graph.facebook.com/${env.metaGraphApiVersion}/${account.accountId}/${endpoint}`;

  if (image) {
    assertRasterImage(image, "facebook", [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
    ]);

    const formData = new FormData();

    formData.set("message", post.caption);
    formData.set("access_token", account.accessToken);
    formData.set(
      "source",
      new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }),
      post.image_name ?? "opsui-post.png",
    );

    const payload = await assertResponseOk(
      await fetch(url, {
        method: "POST",
        body: formData,
      }),
      "Facebook photo publish failed.",
    );

    return getNestedString(payload, ["post_id"]) ?? getNestedString(payload, ["id"]);
  }

  const body = new URLSearchParams({
    message: post.caption,
    access_token: account.accessToken,
  });

  const payload = await assertResponseOk(
    await fetch(url, {
      method: "POST",
      body,
    }),
    "Facebook post publish failed.",
  );

  return getNestedString(payload, ["id"]);
};

const publishInstagram = async (
  post: DbScheduledSocialPostWithCreatorRow,
  account: SocialAccountConfig,
  options: PublishOptions,
) => {
  const image = parsePostImage(post);

  if (!image) {
    throw new Error("Instagram publishing requires an image.");
  }

  assertRasterImage(image, "instagram", [
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);

  const imageUrl = buildPostImageUrl(post, options);
  const createUrl = `https://graph.facebook.com/${env.metaGraphApiVersion}/${account.accountId}/media`;
  const createPayload = await assertResponseOk(
    await fetch(createUrl, {
      method: "POST",
      body: new URLSearchParams({
        image_url: imageUrl,
        caption: post.caption,
        access_token: account.accessToken,
      }),
    }),
    "Instagram media container creation failed.",
  );
  const creationId = getNestedString(createPayload, ["id"]);

  if (!creationId) {
    throw new Error("Instagram did not return a media container ID.");
  }

  const publishUrl = `https://graph.facebook.com/${env.metaGraphApiVersion}/${account.accountId}/media_publish`;
  const publishPayload = await assertResponseOk(
    await fetch(publishUrl, {
      method: "POST",
      body: new URLSearchParams({
        creation_id: creationId,
        access_token: account.accessToken,
      }),
    }),
    "Instagram media publish failed.",
  );

  return getNestedString(publishPayload, ["id"]) ?? creationId;
};

const normalizeLinkedInAuthor = (accountId: string) => {
  if (accountId.startsWith("urn:li:")) {
    return accountId;
  }

  return `urn:li:organization:${accountId}`;
};

const linkedInHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  "Content-Type": "application/json",
  "LinkedIn-Version": env.linkedinApiVersion,
  "X-Restli-Protocol-Version": "2.0.0",
});

const uploadLinkedInImage = async (
  image: ParsedDataUrl,
  imageName: string | null,
  author: string,
  account: SocialAccountConfig,
) => {
  assertRasterImage(image, "linkedin", [
    "image/jpeg",
    "image/png",
    "image/gif",
  ]);

  const initializePayload = await assertResponseOk(
    await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
      method: "POST",
      headers: linkedInHeaders(account.accessToken),
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: author,
        },
      }),
    }),
    "LinkedIn image upload initialization failed.",
  );
  const imageUrn = getNestedString(initializePayload, ["value", "image"]);
  const uploadUrl = getNestedString(initializePayload, ["value", "uploadUrl"]);

  if (!imageUrn || !uploadUrl) {
    throw new Error("LinkedIn did not return an image upload URL.");
  }

  await assertResponseOk(
    await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        "Content-Type": image.mimeType,
      },
      body: new Blob([new Uint8Array(image.buffer)], {
        type: image.mimeType,
      }),
    }),
    `LinkedIn image upload failed for ${imageName ?? "post image"}.`,
  );

  return imageUrn;
};

const publishLinkedIn = async (
  post: DbScheduledSocialPostWithCreatorRow,
  account: SocialAccountConfig,
) => {
  const author = normalizeLinkedInAuthor(account.accountId);
  const image = parsePostImage(post);
  const content = image
    ? {
        media: {
          id: await uploadLinkedInImage(
            image,
            post.image_name,
            author,
            account,
          ),
          title: post.image_name ?? "OpsUI post image",
        },
      }
    : undefined;
  const body = {
    author,
    commentary: post.caption || " ",
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
    ...(content ? { content } : {}),
  };
  const response = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: linkedInHeaders(account.accessToken),
    body: JSON.stringify(body),
  });
  const payload = await assertResponseOk(response, "LinkedIn post publish failed.");

  return response.headers.get("x-restli-id") ?? getNestedString(payload, ["id"]);
};

// X (OAuth2 user) access tokens expire after ~2h. When the connected account
// has a refresh token and the X app client credentials are configured, swap in
// a fresh access token automatically instead of failing the post.
const isXRefreshable = (account: SocialAccountConfig) =>
  account.platform === "twitter" &&
  Boolean(account.refreshToken) &&
  Boolean(env.xClientId) &&
  Boolean(env.xClientSecret);

const refreshXAccessToken = async (
  account: SocialAccountConfig,
): Promise<void> => {
  if (!account.refreshToken) {
    throw new Error("No X refresh token is stored for this account.");
  }

  const payload = await assertResponseOk(
    await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${env.xClientId}:${env.xClientSecret}`,
        ).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: account.refreshToken,
        client_id: env.xClientId,
      }),
    }),
    "X token refresh failed.",
  );
  const newAccessToken = getNestedString(payload, ["access_token"]);

  if (!newAccessToken) {
    throw new Error("X token refresh returned no access token.");
  }

  const newRefreshToken =
    getNestedString(payload, ["refresh_token"]) ?? account.refreshToken;
  const expiresInRaw = payload?.["expires_in"];
  const expiresIn = typeof expiresInRaw === "number" ? expiresInRaw : 7200;
  const newExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  if (account.source === "database") {
    await storage.updateSocialAccountTokens(account.id, {
      accessToken: newAccessToken,
      expiresAt: newExpiresAt,
      metadataJson: JSON.stringify({ refreshToken: newRefreshToken }),
    });
  }

  // Update the in-memory account so the rest of this publish uses the new token.
  account.accessToken = newAccessToken;
  account.refreshToken = newRefreshToken;
  account.expiresAt = newExpiresAt;
};

// Proactively refresh when the stored token is known to be expired (or about to).
const ensureFreshXToken = async (account: SocialAccountConfig) => {
  if (!isXRefreshable(account) || !account.expiresAt) {
    return;
  }

  const expiresMs = new Date(account.expiresAt).getTime();

  if (Number.isNaN(expiresMs) || expiresMs - Date.now() > 60_000) {
    return;
  }

  await refreshXAccessToken(account);
};

const uploadXMedia = async (
  image: ParsedDataUrl,
  account: SocialAccountConfig,
) => {
  assertRasterImage(image, "twitter", [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ]);

  const payload = await assertResponseOk(
    await fetch("https://api.x.com/2/media/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        media: image.buffer.toString("base64"),
        media_category: "tweet_image",
        media_type: image.mimeType,
      }),
    }),
    "X media upload failed.",
  );

  return (
    getNestedString(payload, ["data", "id"]) ??
    getNestedString(payload, ["data", "media_id"]) ??
    getNestedString(payload, ["media_id_string"]) ??
    getNestedString(payload, ["id"])
  );
};

const publishX = async (
  post: DbScheduledSocialPostWithCreatorRow,
  account: SocialAccountConfig,
) => {
  const image = parsePostImage(post);

  const runOnce = async () => {
    const mediaId = image ? await uploadXMedia(image, account) : null;
    const payload = await assertResponseOk(
      await fetch("https://api.x.com/2/tweets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: post.caption || undefined,
          ...(mediaId
            ? {
                media: {
                  media_ids: [mediaId],
                },
              }
            : {}),
        }),
      }),
      "X post publish failed.",
    );

    return (
      getNestedString(payload, ["data", "id"]) ?? getNestedString(payload, ["id"])
    );
  };

  await ensureFreshXToken(account);

  try {
    return await runOnce();
  } catch (error) {
    // Token may have expired mid-flight (or the stored expiry was unknown);
    // refresh once and retry before surfacing the failure.
    if (
      isXRefreshable(account) &&
      (error as { status?: number }).status === 401
    ) {
      await refreshXAccessToken(account);
      return runOnce();
    }

    throw error;
  }
};

const publishDirectly = async (
  post: DbScheduledSocialPostWithCreatorRow,
  account: SocialAccountConfig,
  options: PublishOptions,
) => {
  if (post.platform === "facebook") {
    return publishFacebook(post, account);
  }

  if (post.platform === "instagram") {
    return publishInstagram(post, account, options);
  }

  if (post.platform === "linkedin") {
    return publishLinkedIn(post, account);
  }

  return publishX(post, account);
};

const publishViaWebhook = async (
  post: DbScheduledSocialPostWithCreatorRow,
): Promise<PublishResult> => {
  const response = await fetch(env.socialPublishWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: post.id,
      platform: post.platform,
      caption: post.caption,
      imageDataUrl: post.image_data_url,
      imageName: post.image_name,
      scheduledFor: post.scheduled_for,
      timezone: post.timezone,
      createdByUserId: post.created_by_user_id,
      createdByUserName: post.created_by_user_name,
    }),
  });
  const { payload, text } = await readJsonResponse(response);

  if (!response.ok) {
    return {
      status: "failed",
      message: getResponseErrorMessage(
        payload,
        text,
        "Social publish webhook failed.",
      ),
    };
  }

  return {
    status: "published",
    message:
      getNestedString(payload, ["message"]) ??
      "Published by social publish webhook.",
    externalPostId:
      getNestedString(payload, ["externalPostId"]) ??
      getNestedString(payload, ["id"]) ??
      undefined,
  };
};

export const publishScheduledSocialPost = async (
  post: DbScheduledSocialPostWithCreatorRow,
  options: PublishOptions = {},
): Promise<PublishResult> => {
  const account = await resolveAccountForPost(post);

  if (!account) {
    if (env.socialPublishWebhookUrl) {
      return publishViaWebhook(post);
    }

    return {
      status: "connection_required",
      message:
        "Social publishing is queued, but this platform account is not connected yet.",
    };
  }

  try {
    const externalPostId = await publishDirectly(post, account, options);

    return {
      status: "published",
      message: `Published to ${platformLabels[post.platform]}.`,
      externalPostId: externalPostId ?? undefined,
    };
  } catch (error) {
    return {
      status: "failed",
      message:
        error instanceof Error
          ? error.message
          : `${platformLabels[post.platform]} publish failed.`,
    };
  }
};

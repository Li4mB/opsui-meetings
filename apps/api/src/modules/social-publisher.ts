import { env } from "../config/env.js";
import type { DbScheduledSocialPostWithCreatorRow } from "../db/adapter.js";

type PublishResult = {
  status: "published" | "failed" | "connection_required";
  message: string;
  externalPostId?: string;
};

export const publishScheduledSocialPost = async (
  post: DbScheduledSocialPostWithCreatorRow,
): Promise<PublishResult> => {
  if (!env.socialPublishWebhookUrl) {
    return {
      status: "connection_required",
      message:
        "Social publishing is queued, but platform accounts are not connected yet.",
    };
  }

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

  const responseText = await response.text();
  let payload: Record<string, unknown> | null = null;

  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    return {
      status: "failed",
      message:
        typeof payload?.message === "string"
          ? payload.message
          : responseText || "Social publish webhook failed.",
    };
  }

  return {
    status: "published",
    message:
      typeof payload?.message === "string"
        ? payload.message
        : "Published by social publish webhook.",
    externalPostId:
      typeof payload?.externalPostId === "string"
        ? payload.externalPostId
        : typeof payload?.id === "string"
          ? payload.id
          : undefined,
  };
};

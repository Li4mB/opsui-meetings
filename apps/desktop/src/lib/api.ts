import { z } from "zod";
import {
  aiMeetingGuideBindingSchema,
  aiMeetingGuideRequestSchema,
  aiMeetingGuideSchema,
  aiPostContentRequestSchema,
  aiPostContentSchema,
  aiPostHistoryResponseSchema,
  aiPostImageRequestSchema,
  aiPostImageSchema,
  aiPlanPostRequestSchema,
  aiPostPlanSchema,
  aiPostChatRequestSchema,
  aiPostChatResponseSchema,
  autoPostAgentConfigResponseSchema,
  bulkReviewSocialPostsInputSchema,
  duplicateScheduledPostInputSchema,
  editScheduledPostCaptionInputSchema,
  reviewSocialPostInputSchema,
  updateAutoPostAgentConfigInputSchema,
  authBootstrapSchema,
  authMeSchema,
  assignmentInputSchema,
  connectSocialAccountInputSchema,
  createMeetingRequestInputSchema,
  createUserInputSchema,
  loftAccessResponseSchema,
  loftBookingsResponseSchema,
  meetingRequestSchema,
  meetingsResponseSchema,
  meetingSchema,
  publishSocialPostsInputSchema,
  publishSocialPostsResponseSchema,
  scheduledSocialPostsResponseSchema,
  rescheduleSocialPostInputSchema,
  scheduleSocialPostsInputSchema,
  socialAccountsResponseSchema,
  type LoginInput,
  sessionSchema,
  syncResponseSchema,
  updateUserInputSchema,
  userSchema,
} from "@opsui/shared";

const DEFAULT_API_BASE_URL = import.meta.env.DEV
  ? "http://localhost:8787"
  : "https://opsui-meetings.onrender.com";

const API_BASE_URL =
  import.meta.env.VITE_OPSUI_API_BASE_URL ?? DEFAULT_API_BASE_URL;

// Full-resolution image for a scheduled post (the assets route is unauthenticated,
// so this can be used directly as an <img> src).
export const scheduledPostImageUrl = (postId: string) =>
  `${API_BASE_URL}/social-posts/assets/${encodeURIComponent(postId)}/image`;

const buildCandidateApiBaseUrls = () => {
  const urls = [API_BASE_URL];

  try {
    const parsed = new URL(API_BASE_URL);

    if (parsed.hostname === "localhost") {
      parsed.hostname = "127.0.0.1";
      urls.push(parsed.toString().replace(/\/$/, ""));
    }
  } catch {
    return urls;
  }

  return [...new Set(urls)];
};

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const request = async <T>(
  path: string,
  init: RequestInit,
  schema?: z.ZodType<T>,
): Promise<T> => {
  const headers = new Headers(init.headers ?? {});

  if (init.body) {
    headers.set("Content-Type", "application/json");
  }

  const candidateBaseUrls = buildCandidateApiBaseUrls();
  let response: Response | null = null;
  let lastError: unknown;

  for (const baseUrl of candidateBaseUrls) {
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers,
      });
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!response) {
    throw lastError instanceof Error
      ? lastError
      : new Error("Unable to reach OpsUI API");
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.message ?? payload ?? "Request failed",
    );
  }

  if (!schema) {
    return payload as T;
  }

  return schema.parse(payload);
};

const withToken = (token: string) => ({
  Authorization: `Bearer ${token}`,
});

export const login = (input: LoginInput) =>
  request("/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  }, sessionSchema);

export const getAuthBootstrap = () =>
  request(
    "/auth/bootstrap",
    {
      method: "GET",
    },
    authBootstrapSchema,
  );

export const getCurrentSessionUser = (token: string) =>
  request(
    "/auth/me",
    {
      method: "GET",
      headers: withToken(token),
    },
    authMeSchema,
  );

export const getUsers = (token: string) =>
  request(
    "/users",
    {
      method: "GET",
      headers: withToken(token),
    },
    z.array(userSchema),
  );

export const getMeetings = (token: string) =>
  request(
    "/meetings",
    {
      method: "GET",
      headers: withToken(token),
    },
    meetingsResponseSchema,
  );

export const getPastMeetings = (token: string) =>
  request(
    "/meetings/past",
    {
      method: "GET",
      headers: withToken(token),
    },
    meetingsResponseSchema,
  );

export const syncMeetings = (token: string) =>
  request(
    "/meetings/sync",
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify({}),
    },
    syncResponseSchema,
  );

export const assignMeeting = (token: string, meetingId: string, assignedUserId: string | null) =>
  request(
    `/meetings/${meetingId}/assignment`,
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify(assignmentInputSchema.parse({ assignedUserId })),
    },
    meetingSchema,
  );

export const resolveMeeting = async (token: string, meetingId: string) => {
  await request(
    `/meetings/${meetingId}/resolve`,
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify({}),
    },
  );
};

export const generateMeetingGuide = (token: string, meetingId: string) =>
  request(
    "/ai/meeting-guide",
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify(aiMeetingGuideRequestSchema.parse({ meetingId })),
    },
    aiMeetingGuideSchema,
  );

export const getSavedMeetingGuide = (token: string, meetingId: string) =>
  request(
    `/ai/meeting-guide/${meetingId}`,
    {
      method: "GET",
      headers: withToken(token),
    },
    aiMeetingGuideBindingSchema,
  );

export const saveMeetingGuide = (
  token: string,
  meetingId: string,
  guide: z.infer<typeof aiMeetingGuideSchema>,
) =>
  request(
    `/ai/meeting-guide/${meetingId}/save`,
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify(aiMeetingGuideSchema.parse(guide)),
    },
    aiMeetingGuideBindingSchema,
  );

export const generatePostContent = (
  token: string,
  input: z.infer<typeof aiPostContentRequestSchema>,
) =>
  request(
    "/ai/post-content",
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify(aiPostContentRequestSchema.parse(input)),
    },
    aiPostContentSchema,
  );

export const generatePostImage = (
  token: string,
  input: z.infer<typeof aiPostImageRequestSchema>,
) =>
  request(
    "/ai/post-image",
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify(aiPostImageRequestSchema.parse(input)),
    },
    aiPostImageSchema,
  );

export const getPostHistory = (token: string) =>
  request(
    "/ai/post-history",
    { method: "GET", headers: withToken(token) },
    aiPostHistoryResponseSchema,
  );

export const planNextPost = (
  token: string,
  input: z.infer<typeof aiPlanPostRequestSchema>,
) =>
  request(
    "/ai/plan-post",
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify(aiPlanPostRequestSchema.parse(input)),
    },
    aiPostPlanSchema,
  );

export const sendStrategyChat = (
  token: string,
  input: z.infer<typeof aiPostChatRequestSchema>,
) =>
  request(
    "/ai/post-chat",
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify(aiPostChatRequestSchema.parse(input)),
    },
    aiPostChatResponseSchema,
  );

export const getAutoPostAgentConfig = (token: string) =>
  request(
    "/social-posts/agent-config",
    { method: "GET", headers: withToken(token) },
    autoPostAgentConfigResponseSchema,
  );

export const updateAutoPostAgentConfig = (
  token: string,
  input: z.infer<typeof updateAutoPostAgentConfigInputSchema>,
) =>
  request(
    "/social-posts/agent-config",
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify(updateAutoPostAgentConfigInputSchema.parse(input)),
    },
    autoPostAgentConfigResponseSchema,
  );

export const reviewSocialPost = (
  token: string,
  postId: string,
  input: z.infer<typeof reviewSocialPostInputSchema>,
) =>
  request(
    `/social-posts/${postId}/review`,
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify(reviewSocialPostInputSchema.parse(input)),
    },
    scheduledSocialPostsResponseSchema,
  );

export const getScheduledSocialPosts = (token: string) =>
  request(
    "/social-posts",
    {
      method: "GET",
      headers: withToken(token),
    },
    scheduledSocialPostsResponseSchema,
  );

export const getSocialAccounts = (token: string) =>
  request(
    "/social-accounts",
    {
      method: "GET",
      headers: withToken(token),
    },
    socialAccountsResponseSchema,
  );

export const connectSocialAccount = (
  token: string,
  input: z.infer<typeof connectSocialAccountInputSchema>,
) =>
  request(
    "/social-accounts",
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify(connectSocialAccountInputSchema.parse(input)),
    },
    socialAccountsResponseSchema,
  );

export const deleteSocialAccount = (token: string, accountId: string) =>
  request(
    `/social-accounts/${encodeURIComponent(accountId)}`,
    {
      method: "DELETE",
      headers: withToken(token),
    },
    socialAccountsResponseSchema,
  );

export const scheduleSocialPosts = (
  token: string,
  input: z.infer<typeof scheduleSocialPostsInputSchema>,
) =>
  request(
    "/social-posts/schedule",
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify(scheduleSocialPostsInputSchema.parse(input)),
    },
    scheduledSocialPostsResponseSchema,
  );

export const rescheduleSocialPost = (
  token: string,
  postId: string,
  input: z.infer<typeof rescheduleSocialPostInputSchema>,
) =>
  request(
    `/social-posts/${postId}/reschedule`,
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify(rescheduleSocialPostInputSchema.parse(input)),
    },
    scheduledSocialPostsResponseSchema,
  );

export const deleteScheduledSocialPost = (token: string, postId: string) =>
  request(
    `/social-posts/${postId}/delete`,
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify({}),
    },
    scheduledSocialPostsResponseSchema,
  );

export const editScheduledPostCaption = (
  token: string,
  postId: string,
  input: z.infer<typeof editScheduledPostCaptionInputSchema>,
) =>
  request(
    `/social-posts/${postId}/caption`,
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify(editScheduledPostCaptionInputSchema.parse(input)),
    },
    scheduledSocialPostsResponseSchema,
  );

export const duplicateScheduledPost = (
  token: string,
  postId: string,
  input: z.infer<typeof duplicateScheduledPostInputSchema>,
) =>
  request(
    `/social-posts/${postId}/duplicate`,
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify(duplicateScheduledPostInputSchema.parse(input)),
    },
    scheduledSocialPostsResponseSchema,
  );

export const publishScheduledPostNow = (token: string, postId: string) =>
  request(
    `/social-posts/${postId}/publish-now`,
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify({}),
    },
    publishSocialPostsResponseSchema,
  );

export const bulkReviewSocialPosts = (
  token: string,
  input: z.infer<typeof bulkReviewSocialPostsInputSchema>,
) =>
  request(
    "/social-posts/review-bulk",
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify(bulkReviewSocialPostsInputSchema.parse(input)),
    },
    scheduledSocialPostsResponseSchema,
  );

export const publishSocialPosts = (
  token: string,
  input: z.infer<typeof publishSocialPostsInputSchema>,
) =>
  request(
    "/social-posts/publish",
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify(publishSocialPostsInputSchema.parse(input)),
    },
    publishSocialPostsResponseSchema,
  );

export const unlockMeetingGuide = (token: string, meetingId: string) =>
  request(
    `/ai/meeting-guide/${meetingId}/unlock`,
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify({}),
    },
    aiMeetingGuideBindingSchema,
  );

export const createUser = (
  token: string,
  input: z.infer<typeof createUserInputSchema>,
) =>
  request(
    "/users",
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify(createUserInputSchema.parse(input)),
    },
    userSchema,
  );

export const updateUser = (
  token: string,
  userId: string,
  input: z.infer<typeof updateUserInputSchema>,
) =>
  request(
    `/users/${userId}/update`,
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify(updateUserInputSchema.parse(input)),
    },
    userSchema,
  );

export const deleteUser = async (token: string, userId: string) => {
  await request(
    `/users/${userId}/delete`,
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify({}),
    },
  );
};

export const createMeetingRequest = (
  token: string,
  input: z.infer<typeof createMeetingRequestInputSchema>,
) =>
  request(
    "/meeting-requests",
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify(createMeetingRequestInputSchema.parse(input)),
    },
    meetingRequestSchema,
  );

export const getLoftBookings = (token: string) =>
  request(
    "/loft/bookings",
    {
      method: "GET",
      headers: withToken(token),
    },
    loftBookingsResponseSchema,
  );

export const getLoftAccess = (token: string) =>
  request(
    "/loft/access",
    {
      method: "GET",
      headers: withToken(token),
    },
    loftAccessResponseSchema,
  );

export const unlockLoft = (token: string, password: string) =>
  request(
    "/loft/unlock",
    {
      method: "POST",
      headers: withToken(token),
      body: JSON.stringify({ password }),
    },
    loftAccessResponseSchema,
  );

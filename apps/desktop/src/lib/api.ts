import { z } from "zod";
import {
  aiMeetingGuideBindingSchema,
  aiMeetingGuideRequestSchema,
  aiMeetingGuideSchema,
  authMeSchema,
  assignmentInputSchema,
  createMeetingRequestInputSchema,
  createUserInputSchema,
  meetingRequestSchema,
  meetingsResponseSchema,
  meetingSchema,
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

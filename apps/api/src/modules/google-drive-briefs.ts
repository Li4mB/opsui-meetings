import { google } from "googleapis";
import { env } from "../config/env.js";
import type { CalendarMeeting, MeetingBrief } from "../types.js";
import { createGoogleJwt } from "./google-auth.js";

const urlPattern = /https?:\/\/[^\s)]+/gi;
const titlePattern = /^OpsUI Intro\s*-\s*(.+?)\s*-\s*(.+)$/i;

const normaliseCountry = (
  value: string | null | undefined,
): "Australia" | "NZ" | "Unknown" | null => {
  const text = (value ?? "").toLowerCase().trim();

  if (!text) {
    return null;
  }

  if (text.includes("new zealand") || text === "nz") {
    return "NZ";
  }

  if (text.includes("australia") || text === "au") {
    return "Australia";
  }

  return "Unknown";
};

const splitModules = (value: string | null) =>
  (value ?? "")
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);

const normaliseForMatch = (value: string | null | undefined) =>
  (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const parseTitle = (value: string | null | undefined) => {
  const raw = value?.trim() ?? "";
  const match = raw.match(titlePattern);

  if (!match) {
    return {
      title: raw,
      clientName: null,
      company: null,
    };
  }

  return {
    title: raw,
    clientName: match[1].trim(),
    company: match[2].trim(),
  };
};

const extractField = (content: string, labels: string[]) => {
  for (const label of labels) {
    const regex = new RegExp(`^${label}\\s*:\\s*(.+)$`, "im");
    const match = content.match(regex);

    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
};

const extractMeetLink = (content: string) => {
  const sectionMatch = content.match(
    /MEET LINK:?\s*[\r\n]+-+[\r\n]+([\s\S]*?)$/i,
  );

  if (sectionMatch?.[1]) {
    return sectionMatch[1].match(urlPattern)?.[0] ?? null;
  }

  return (
    extractField(content, ["Meet Link"])?.match(urlPattern)?.[0] ??
    content.match(urlPattern)?.find((url) => url.includes("meet.google.com")) ??
    null
  );
};

const extractSection = (content: string, header: string, nextHeaders: string[]) => {
  const escapedHeader = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedNext = nextHeaders.map((item) =>
    item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const tailPattern = escapedNext.length
    ? `(?:\\n\\s*(?:${escapedNext.join("|")})\\s*[\\r\\n]+-+|$)`
    : "$";
  const pattern = new RegExp(
    `${escapedHeader}\\s*[\\r\\n]+-+[\\r\\n]+([\\s\\S]*?)${tailPattern}`,
    "i",
  );
  const match = content.match(pattern);

  return match?.[1]?.trim() ?? null;
};

const toText = async (stream: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
};

const readBriefText = async (
  drive: ReturnType<typeof google.drive>,
  fileId: string,
  mimeType: string,
) => {
  if (mimeType === "application/vnd.google-apps.document") {
    const response = await drive.files.export(
      {
        fileId,
        mimeType: "text/plain",
      },
      {
        responseType: "stream",
      },
    );

    return toText(response.data);
  }

  if (mimeType.startsWith("text/")) {
    const response = await drive.files.get(
      {
        fileId,
        alt: "media",
      },
      {
        responseType: "stream",
      },
    );

    return toText(response.data);
  }

  return null;
};

const parseBriefText = (
  fileId: string,
  fileName: string,
  googleDocUrl: string,
  updatedAt: string,
  content: string,
): MeetingBrief => {
  const eventName = extractField(content, ["Event Name"]);
  const titleParts = parseTitle(eventName ?? fileName);

  return {
    fileId,
    fileName,
    googleDocUrl,
    eventName,
    clientName:
      extractField(content, ["Name", "Client Name"]) ?? titleParts.clientName,
    company: extractField(content, ["Company"]) ?? titleParts.company,
    country: normaliseCountry(extractField(content, ["Country"])),
    meetingType: extractField(content, ["Type", "Meeting Type"]),
    clientEmail: extractField(content, ["Email"]),
    phone: extractField(content, ["Phone"]),
    companySize: extractField(content, ["Company Size", "Team Size"]),
    modulesOfInterest: splitModules(
      extractSection(content, "MODULES OF INTEREST", [
        "ADDITIONAL INFORMATION",
        "MEET LINK",
      ]),
    ),
    additionalInformation: extractSection(content, "ADDITIONAL INFORMATION", [
      "MEET LINK",
    ]),
    googleMeetUrl: extractMeetLink(content),
    updatedAt,
    sourceText: content.trim(),
  };
};

const buildBriefMatchKeys = (brief: MeetingBrief) => {
  const keys = new Set<string>();
  const normalizedTitle = normaliseForMatch(brief.eventName || brief.fileName);
  const normalizedClient = normaliseForMatch(brief.clientName);
  const normalizedCompany = normaliseForMatch(brief.company);

  if (normalizedTitle) {
    keys.add(`title:${normalizedTitle}`);
  }

  if (normalizedClient && normalizedCompany) {
    keys.add(`pair:${normalizedClient}::${normalizedCompany}`);
  }

  if (normalizedClient) {
    keys.add(`client:${normalizedClient}`);
  }

  return [...keys];
};

const buildMeetingMatchKeys = (meeting: CalendarMeeting) => {
  const keys = new Set<string>();
  const normalizedTitle = normaliseForMatch(meeting.title);
  const normalizedClient = normaliseForMatch(meeting.clientName);
  const normalizedCompany = normaliseForMatch(meeting.company);

  if (normalizedTitle) {
    keys.add(`title:${normalizedTitle}`);
  }

  if (normalizedClient && normalizedCompany) {
    keys.add(`pair:${normalizedClient}::${normalizedCompany}`);
  }

  if (normalizedClient) {
    keys.add(`client:${normalizedClient}`);
  }

  return [...keys];
};

export const fetchMeetingBriefs = async (): Promise<MeetingBrief[]> => {
  if (!env.googleDriveBriefsFolderId || env.useSampleData) {
    return [];
  }

  const auth = createGoogleJwt([
    "https://www.googleapis.com/auth/drive.readonly",
  ]);
  const drive = google.drive({ version: "v3", auth });
  const response = await drive.files.list({
    q: `'${env.googleDriveBriefsFolderId}' in parents and trashed = false`,
    pageSize: 200,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    fields:
      "files(id,name,mimeType,webViewLink,modifiedTime)",
  });

  const files = response.data.files ?? [];
  const briefs = await Promise.all(
    files.map(async (file) => {
      if (!file.id || !file.name || !file.mimeType) {
        return null;
      }

      try {
        const text = await readBriefText(drive, file.id, file.mimeType);

        if (!text?.trim()) {
          return null;
        }

        return parseBriefText(
          file.id,
          file.name,
          file.webViewLink ?? `https://docs.google.com/document/d/${file.id}/edit`,
          file.modifiedTime
            ? new Date(file.modifiedTime).toISOString()
            : new Date().toISOString(),
          text,
        );
      } catch {
        return null;
      }
    }),
  );

  return briefs.filter((brief): brief is MeetingBrief => Boolean(brief));
};

export const mergeMeetingBriefs = (
  meetings: CalendarMeeting[],
  briefs: MeetingBrief[],
): CalendarMeeting[] => {
  const briefsByKey = new Map<string, MeetingBrief>();

  for (const brief of briefs) {
    for (const key of buildBriefMatchKeys(brief)) {
      const existing = briefsByKey.get(key);

      if (!existing || existing.updatedAt < brief.updatedAt) {
        briefsByKey.set(key, brief);
      }
    }
  }

  return meetings.map((meeting) => {
    const match = buildMeetingMatchKeys(meeting)
      .map((key) => briefsByKey.get(key))
      .find(Boolean);

    if (!match) {
      return meeting;
    }

    const mergedDescription = [
      meeting.descriptionRaw.trim(),
      match.additionalInformation
        ? `Drive brief notes:\n${match.additionalInformation.trim()}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      ...meeting,
      clientName: match.clientName ?? meeting.clientName,
      company: match.company ?? meeting.company,
      country:
        match.country && match.country !== "Unknown"
          ? match.country
          : meeting.country,
      meetingType: match.meetingType ?? meeting.meetingType,
      googleMeetUrl: match.googleMeetUrl ?? meeting.googleMeetUrl,
      googleDocUrl: match.googleDocUrl ?? meeting.googleDocUrl,
      clientEmail: match.clientEmail ?? meeting.clientEmail,
      phone: match.phone ?? meeting.phone,
      companySize: match.companySize ?? meeting.companySize,
      modulesOfInterest: match.modulesOfInterest.length
        ? match.modulesOfInterest
        : meeting.modulesOfInterest,
      descriptionRaw: mergedDescription || meeting.descriptionRaw,
      updatedAt:
        match.updatedAt > meeting.updatedAt ? match.updatedAt : meeting.updatedAt,
    };
  });
};

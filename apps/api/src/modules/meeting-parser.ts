import type { calendar_v3 } from "googleapis";
import type { CalendarMeeting } from "../types.js";

const titlePattern = /^OpsUI Intro\s*-\s*(.+?)\s*-\s*(.+)$/i;
const urlPattern = /https?:\/\/[^\s)]+/g;

const extractLabel = (description: string, labels: string[]) => {
  for (const label of labels) {
    const regex = new RegExp(`${label}\\s*:?\\s*(.+)`, "i");
    const match = description.match(regex);
    if (match?.[1]) {
      return match[1].split(/\r?\n/)[0].trim();
    }
  }

  return null;
};

const normaliseCountry = (value: string | null): "Australia" | "NZ" | "Unknown" => {
  const text = (value ?? "").toLowerCase();

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
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);

const parseTitle = (summary: string | null | undefined) => {
  const fallback = summary?.trim() || "OpsUI Demo";
  const match = fallback.match(titlePattern);

  if (!match) {
    return {
      title: fallback,
      clientName: "Unknown Client",
      company: "Unknown Company",
    };
  }

  return {
    title: fallback,
    clientName: match[1].trim(),
    company: match[2].trim(),
  };
};

const getDateTime = (value: calendar_v3.Schema$EventDateTime | undefined, fallback: string) => {
  if (value?.dateTime) {
    return new Date(value.dateTime).toISOString();
  }

  if (value?.date) {
    return new Date(value.date).toISOString();
  }

  return fallback;
};

export const parseCalendarEvent = (
  event: calendar_v3.Schema$Event,
): CalendarMeeting | null => {
  if (event.status === "cancelled" || !event.id) {
    return null;
  }

  const description = event.description?.trim() ?? "";
  const urls = description.match(urlPattern) ?? [];
  const googleDocUrl = urls.find((url) => url.includes("docs.google.com")) ?? null;
  const { title, clientName, company } = parseTitle(event.summary);
  const clientAttendee = event.attendees?.find((attendee) => attendee.email && !attendee.organizer);
  const now = new Date().toISOString();

  return {
    googleEventId: event.id,
    title,
    clientName,
    company,
    country: normaliseCountry(extractLabel(description, ["country"])),
    meetingType: extractLabel(description, ["meeting type"]) ?? "Demo",
    startAtUtc: getDateTime(event.start, now),
    endAtUtc: getDateTime(event.end, now),
    sourceTimezone: event.start?.timeZone ?? "UTC",
    googleMeetUrl: event.hangoutLink ?? null,
    googleDocUrl,
    clientEmail: clientAttendee?.email ?? null,
    phone: extractLabel(description, ["phone", "contact phone"]),
    companySize: extractLabel(description, ["company size", "team size"]),
    modulesOfInterest: splitModules(extractLabel(description, ["modules of interest", "modules"])),
    descriptionRaw: description,
    calendarHtmlUrl: event.htmlLink ?? null,
    updatedAt: event.updated ? new Date(event.updated).toISOString() : now,
  };
};

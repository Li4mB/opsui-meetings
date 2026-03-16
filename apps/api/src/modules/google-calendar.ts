import { addDays, subDays } from "date-fns";
import { google } from "googleapis";
import { env } from "../config/env.js";
import { parseCalendarEvent } from "./meeting-parser.js";
import { createGoogleJwt } from "./google-auth.js";
import { fetchMeetingBriefs, mergeMeetingBriefs } from "./google-drive-briefs.js";
import type { CalendarMeeting } from "../types.js";

const buildSampleMeetings = (): CalendarMeeting[] => {
  const now = new Date();

  return Array.from({ length: 8 }, (_, index) => {
    const start = addDays(now, index - 2);
    start.setHours(9 + (index % 4) * 2, 0, 0, 0);
    const end = new Date(start.getTime() + 45 * 60 * 1000);
    const country = index % 2 === 0 ? "Australia" : "NZ";
    const clientName = ["Sophie Lane", "Noah Reid", "Ava Turner", "Leo Brooks"][index % 4];
    const company = ["Westwind Logistics", "Blue Summit Health", "Harbour Retail", "Southern Works"][index % 4];

    return {
      googleEventId: `sample-${index + 1}`,
      title: `OpsUI Intro - ${clientName} - ${company}`,
      clientName,
      company,
      country,
      meetingType: index % 3 === 0 ? "Expansion Demo" : "Intro Demo",
      startAtUtc: start.toISOString(),
      endAtUtc: end.toISOString(),
      sourceTimezone: country === "Australia" ? "Australia/Sydney" : "Pacific/Auckland",
      googleMeetUrl: `https://meet.google.com/sample-${index + 1}`,
      googleDocUrl: `https://docs.google.com/document/d/sample-${index + 1}`,
      clientEmail: `${clientName.toLowerCase().replace(/\s+/g, ".")}@example.com`,
      phone: `+61 400 000 00${index}`,
      companySize: ["11-50", "51-200", "201-500"][index % 3],
      modulesOfInterest: ["Field Ops", "Scheduling", index % 2 === 0 ? "Analytics" : "Asset Tracking"],
      descriptionRaw: `Country: ${country}\nMeeting Type: Intro Demo\nPhone: +61 400 000 00${index}\nCompany Size: 11-50\nModules of Interest: Field Ops, Scheduling`,
      calendarHtmlUrl: null,
      updatedAt: now.toISOString(),
    };
  });
};

export const fetchCalendarMeetings = async (): Promise<CalendarMeeting[]> => {
  const hasGoogleConfig = Boolean(env.googleCalendarId && env.googleServiceAccountJson);

  if (!hasGoogleConfig || env.useSampleData) {
    return buildSampleMeetings();
  }

  const auth = createGoogleJwt([
    "https://www.googleapis.com/auth/calendar.readonly",
  ]);

  const calendar = google.calendar({ version: "v3", auth });
  const [response, briefs] = await Promise.all([
    calendar.events.list({
      calendarId: env.googleCalendarId,
      timeMin: subDays(new Date(), 30).toISOString(),
      timeMax: addDays(new Date(), 90).toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    }),
    fetchMeetingBriefs(),
  ]);

  const meetings = (response.data.items ?? [])
    .map((event) => parseCalendarEvent(event))
    .filter((meeting): meeting is CalendarMeeting => Boolean(meeting));

  return mergeMeetingBriefs(meetings, briefs);
};

import { format, isSameDay } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type { Meeting } from "@opsui/shared";
import { viewerTimeZone } from "./platform";

export const formatMeetingWindow = (meeting: Meeting) => {
  const start = new Date(meeting.startAtUtc);
  const end = new Date(meeting.endAtUtc);

  if (isSameDay(start, end)) {
    return `${formatInTimeZone(start, viewerTimeZone, "EEE d MMM, h:mm a")} - ${formatInTimeZone(
      end,
      viewerTimeZone,
      "h:mm a zzz",
    )}`;
  }

  return `${formatInTimeZone(start, viewerTimeZone, "EEE d MMM, h:mm a")} -> ${formatInTimeZone(
    end,
    viewerTimeZone,
    "EEE d MMM, h:mm a zzz",
  )}`;
};

export const formatMeetingGroupLabel = (isoString: string) =>
  formatInTimeZone(new Date(isoString), viewerTimeZone, "EEEE d MMMM");

export const formatMeetingTimeChip = (isoString: string) =>
  formatInTimeZone(new Date(isoString), viewerTimeZone, "h:mm a");

export const formatSyncTimestamp = (isoString: string | null) => {
  if (!isoString) {
    return "Not synced yet";
  }

  return format(new Date(isoString), "dd MMM yyyy, h:mm a");
};

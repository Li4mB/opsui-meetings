import type { Meeting } from "@opsui/shared";

const cleanModuleToken = (value: string) =>
  value
    .trim()
    .replace(/^\[+/, "")
    .replace(/\]+$/, "")
    .replace(/^"+|"+$/g, "")
    .trim();

const normalizeModuleEntry = (value: string): string[] => {
  const trimmed = value.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;

      if (Array.isArray(parsed)) {
        return parsed.flatMap((item) => normalizeModuleEntry(String(item)));
      }
    } catch {
      // Fall through when upstream data contains partial serialized fragments.
    }
  }

  const cleaned = cleanModuleToken(trimmed);
  return cleaned ? [cleaned] : [];
};

export const normalizeModulesOfInterest = (modules: string[]) => {
  const seen = new Set<string>();

  for (const entry of modules) {
    for (const module of normalizeModuleEntry(entry)) {
      seen.add(module);
    }
  }

  return Array.from(seen);
};

export const normalizeMeeting = (meeting: Meeting): Meeting => ({
  ...meeting,
  modulesOfInterest: normalizeModulesOfInterest(meeting.modulesOfInterest),
});

export const normalizeMeetings = (meetings: Meeting[]) =>
  meetings.map(normalizeMeeting);

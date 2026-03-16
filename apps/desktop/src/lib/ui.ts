import type { Country } from "@opsui/shared";

const modulePalette = [
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#8B5CF6",
  "#EC4899",
  "#06B6D4",
];

export const getInitials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || "OP";

export const getCountryLabel = (country: Country) =>
  country === "NZ" ? "New Zealand" : country;

export const getCountryFlag = (country: Country) => {
  if (country === "Australia") {
    return "AU";
  }

  if (country === "NZ") {
    return "NZ";
  }

  return "--";
};

export const getModuleColor = (module: string) => {
  let hash = 0;

  for (let index = 0; index < module.length; index += 1) {
    hash = module.charCodeAt(index) + ((hash << 5) - hash);
  }

  return modulePalette[Math.abs(hash) % modulePalette.length];
};

export const getMeetingTypeTone = (meetingType: string) => {
  const normalized = meetingType.toLowerCase();

  if (
    normalized.includes("onsite") ||
    normalized.includes("on-site") ||
    normalized.includes("in person")
  ) {
    return "onsite";
  }

  return "remote";
};

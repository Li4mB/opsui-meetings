import { google } from "googleapis";
import { env } from "../config/env.js";
import { createGoogleJwt } from "./google-auth.js";

export type SheetProspect = {
  name: string;
  phone: string;
  companyName: string;
  email: string | null;
  notes: string;
  externalId: string;
};

const headerAliases = {
  id: ["id", "prospect id", "external id", "row id", "url", "place url"],
  name: [
    "name",
    "full name",
    "prospect name",
    "contact name",
    "title",
    "business",
    "business name",
    "company",
    "company name",
  ],
  phone: ["phone", "phone number", "mobile", "mobile number", "telephone"],
  companyName: [
    "company",
    "company name",
    "business",
    "business name",
    "title",
    "name",
  ],
  email: ["email", "email address"],
  notes: ["notes", "note", "additional info", "additional information"],
  website: ["website", "site", "web"],
  placeUrl: ["url", "place url", "google url", "google maps url"],
  street: ["street", "address", "street address"],
  city: ["city", "suburb"],
  state: ["state", "region"],
  countryCode: ["country code", "country"],
  category: ["category name", "category", "primary category", "categories 0"],
  rating: ["total score", "rating", "score"],
  reviewCount: ["reviews count", "review count", "reviews"],
} as const;

const normalizeHeader = (value: string) =>
  value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_/-]+/g, " ")
    .replace(/\s+/g, " ");

const buildHeaderMap = (headers: unknown[]) =>
  headers.reduce<Record<string, number>>((accumulator, header, index) => {
    if (typeof header === "string" && header.trim()) {
      accumulator[normalizeHeader(header)] = index;
    }

    return accumulator;
  }, {});

const getValue = (
  row: unknown[],
  headerMap: Record<string, number>,
  aliases: readonly string[],
) => {
  for (const alias of aliases) {
    const index = headerMap[normalizeHeader(alias)];

    if (index === undefined) {
      continue;
    }

    const value = row[index];

    if (typeof value === "string" || typeof value === "number") {
      return String(value).trim();
    }
  }

  return "";
};

const quoteSheetTitle = (title: string) =>
  `'${title.replace(/'/g, "''")}'!A:Z`;

const resolveProspectRanges = async (
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
) => {
  if (env.googleProspectsSheetRanges.length) {
    return env.googleProspectsSheetRanges;
  }

  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(title,sheetType))",
  });

  const ranges = (metadata.data.sheets ?? [])
    .map((sheet) => sheet.properties)
    .filter((properties) => properties?.title && properties.sheetType === "GRID")
    .map((properties) => quoteSheetTitle(properties!.title!));

  if (!ranges.length) {
    throw new Error("No readable sheet tabs were found in the prospects document");
  }

  return ranges;
};

const joinAddressParts = (parts: string[]) => parts.filter(Boolean).join(", ");

const buildFallbackNotes = (
  row: unknown[],
  headerMap: Record<string, number>,
) => {
  const explicitNotes = getValue(row, headerMap, headerAliases.notes);

  if (explicitNotes) {
    return explicitNotes;
  }

  const website = getValue(row, headerMap, headerAliases.website);
  const placeUrl = getValue(row, headerMap, headerAliases.placeUrl);
  const address = joinAddressParts([
    getValue(row, headerMap, headerAliases.street),
    getValue(row, headerMap, headerAliases.city),
    getValue(row, headerMap, headerAliases.state),
    getValue(row, headerMap, headerAliases.countryCode),
  ]);
  const category = getValue(row, headerMap, headerAliases.category);
  const rating = getValue(row, headerMap, headerAliases.rating);
  const reviewCount = getValue(row, headerMap, headerAliases.reviewCount);
  const ratingSummary =
    rating && reviewCount ? `${rating} (${reviewCount} reviews)` : rating;

  return [
    ["Website", website],
    ["Google URL", placeUrl],
    ["Address", address],
    ["Category", category],
    ["Rating", ratingSummary],
  ]
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n")
    .slice(0, 2000);
};

export const parseProspectsFromValues = (
  values: unknown[][],
  rangeLabel: string,
  spreadsheetId: string,
) => {
  if (values.length < 2) {
    return [];
  }

  const [headers, ...rows] = values;
  const headerMap = buildHeaderMap(headers ?? []);

  return rows
    .map((row, index): SheetProspect | null => {
      const name = getValue(row, headerMap, headerAliases.name);
      const phone = getValue(row, headerMap, headerAliases.phone);
      const companyName = getValue(row, headerMap, headerAliases.companyName);

      if (!name || !phone || !companyName) {
        return null;
      }

      const rawId = getValue(row, headerMap, headerAliases.id);
      const rowNumber = index + 2;
      const externalId = [
        "google_sheet",
        spreadsheetId,
        rangeLabel,
        rawId || `row-${rowNumber}`,
      ].join(":");

      return {
        name,
        phone,
        companyName,
        email: getValue(row, headerMap, headerAliases.email) || null,
        notes: buildFallbackNotes(row, headerMap),
        externalId,
      };
    })
    .filter((prospect): prospect is SheetProspect => Boolean(prospect));
};

export const fetchGoogleSheetProspects = async (): Promise<SheetProspect[]> => {
  if (!env.googleProspectsSheetIds.length) {
    throw new Error("No Google prospects sheets are configured");
  }

  const auth = createGoogleJwt([
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ]);
  const sheets = google.sheets({ version: "v4", auth });
  const results = await Promise.all(
    env.googleProspectsSheetIds.map(async (spreadsheetId) => {
      const ranges = await resolveProspectRanges(sheets, spreadsheetId);
      const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges,
      });

      return (response.data.valueRanges ?? []).flatMap((valueRange, index) =>
        parseProspectsFromValues(
          valueRange.values ?? [],
          valueRange.range ?? ranges[index] ?? `range-${index + 1}`,
          spreadsheetId,
        ),
      );
    }),
  );

  return results.flat();
};

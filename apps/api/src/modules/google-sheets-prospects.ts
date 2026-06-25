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
  id: ["id", "prospect id", "external id", "row id"],
  name: ["name", "full name", "prospect name", "contact name"],
  phone: ["phone", "phone number", "mobile", "mobile number"],
  companyName: ["company", "company name", "business", "business name"],
  email: ["email", "email address"],
  notes: ["notes", "note", "additional info", "additional information"],
} as const;

const normalizeHeader = (value: string) =>
  value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

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
) => {
  if (env.googleProspectsSheetRanges.length) {
    return env.googleProspectsSheetRanges;
  }

  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: env.googleProspectsSheetId,
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

const parseProspectsFromValues = (
  values: unknown[][],
  rangeLabel: string,
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
        env.googleProspectsSheetId,
        rangeLabel,
        rawId || `row-${rowNumber}`,
      ].join(":");

      return {
        name,
        phone,
        companyName,
        email: getValue(row, headerMap, headerAliases.email) || null,
        notes: getValue(row, headerMap, headerAliases.notes),
        externalId,
      };
    })
    .filter((prospect): prospect is SheetProspect => Boolean(prospect));
};

export const fetchGoogleSheetProspects = async (): Promise<SheetProspect[]> => {
  if (!env.googleProspectsSheetId) {
    throw new Error("OPSUI_GOOGLE_PROSPECTS_SHEET_ID is not configured");
  }

  const auth = createGoogleJwt([
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ]);
  const sheets = google.sheets({ version: "v4", auth });
  const ranges = await resolveProspectRanges(sheets);
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: env.googleProspectsSheetId,
    ranges,
  });

  return (response.data.valueRanges ?? []).flatMap((valueRange, index) =>
    parseProspectsFromValues(
      valueRange.values ?? [],
      valueRange.range ?? ranges[index] ?? `range-${index + 1}`,
    ),
  );
};

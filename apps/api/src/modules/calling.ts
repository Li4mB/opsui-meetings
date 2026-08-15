import {
  callingExternalCallSchema,
  callingBatchStartResponseSchema,
  callingCallCompletionInputSchema,
  callingCallSchema,
  callingProspectSchema,
  callingProspectsSyncResponseSchema,
  callingSheetSourceSchema,
  callingWorkspaceResponseSchema,
  vapiServerEventSchema,
  createCallingBatchInputSchema,
  createCallingProspectInputSchema,
  createCallingSheetSourceInputSchema,
  createCallingTestCallInputSchema,
} from "@opsui/shared";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { z } from "zod";
import { env } from "../config/env.js";
import { storage } from "../db/database.js";
import type { StorageAdapter } from "../db/adapter.js";
import { authenticateRequest } from "./auth.js";
import {
  fetchGoogleSheetProspects,
  type SheetProspect,
} from "./google-sheets-prospects.js";
import type {
  AuthUser,
  DbCallingBatchRow,
  DbCallingCallRow,
  DbCallingExternalCallRow,
  DbCallingProspectRow,
  DbCallingSheetSourceRow,
  DbCallingTranscriptRole,
  DbCallingTranscriptTurnRow,
} from "../types.js";

const terminalCallStatuses = new Set([
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);

const activeExternalCallStatuses = new Set(["queued", "ringing", "in_progress"]);

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const readString = (record: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return null;
};

const normalizeTimestamp = (value: unknown, fallback: string) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    return new Date(milliseconds).toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return fallback;
};

const normalizeTranscriptRole = (value: unknown): DbCallingTranscriptRole | null => {
  if (value === "assistant" || value === "bot") {
    return "assistant";
  }
  if (value === "user" || value === "customer") {
    return "customer";
  }
  return null;
};

const normalizeExternalStatus = (
  value: unknown,
  fallback: DbCallingExternalCallRow["status"],
) => {
  if (typeof value !== "string") {
    return fallback;
  }

  switch (value.toLowerCase().replaceAll("-", "_")) {
    case "scheduled":
    case "queued":
      return "queued" as const;
    case "ringing":
      return "ringing" as const;
    case "in_progress":
    case "active":
      return "in_progress" as const;
    case "ended":
    case "completed":
      return "ended" as const;
    case "failed":
    case "error":
      return "failed" as const;
    default:
      return fallback;
  }
};

const eventKeyFor = (...parts: Array<string | number | null | undefined>) =>
  createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("\u001f"))
    .digest("hex");

const toCallingProspect = (row: DbCallingProspectRow) =>
  callingProspectSchema.parse({
    id: row.id,
    name: row.name,
    phone: row.phone,
    companyName: row.company_name,
    email: row.email,
    notes: row.notes,
    source: row.source,
    externalId: row.external_id,
    status: row.status,
    lastCallAt: row.last_call_at,
    lastCallOutcome: row.last_call_outcome,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

const toCallingBatch = (row: DbCallingBatchRow) => ({
  id: row.id,
  status: row.status,
  totalCount: row.total_count,
  createdByUserId: row.created_by_user_id,
  createdAt: row.created_at,
  startedAt: row.started_at,
  completedAt: row.completed_at,
});

const toCallingCall = (row: DbCallingCallRow) =>
  callingCallSchema.parse({
    id: row.id,
    batchId: row.batch_id,
    prospectId: row.prospect_id,
    sequenceIndex: row.sequence_index,
    status: row.status,
    outcome: row.outcome,
    notes: row.notes,
    durationSeconds: row.duration_seconds,
    externalCallId: row.external_call_id,
    statusMessage: row.status_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  });

const toCallingExternalCall = (
  row: DbCallingExternalCallRow,
  turns: DbCallingTranscriptTurnRow[],
) =>
  callingExternalCallSchema.parse({
    vapiCallId: row.vapi_call_id,
    source: row.source,
    leadExternalId: row.lead_external_id,
    leadName: row.lead_name,
    companyName: row.company_name,
    phone: row.phone,
    context: JSON.parse(row.context_json) as Record<string, unknown>,
    status: row.status,
    outcome: row.outcome,
    summary: row.summary,
    report: row.report_json
      ? (JSON.parse(row.report_json) as Record<string, unknown>)
      : null,
    partialRole: row.partial_role,
    partialTranscript: row.partial_transcript,
    partialUpdatedAt: row.partial_updated_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    transcriptTurns: turns.map((turn) => ({
      id: turn.id,
      vapiCallId: turn.vapi_call_id,
      eventKey: turn.event_key,
      role: turn.role,
      transcript: turn.transcript,
      occurredAt: turn.occurred_at,
      sequenceIndex: turn.sequence_index,
      createdAt: turn.created_at,
    })),
  });

const toCallingSheetSource = (row: DbCallingSheetSourceRow) =>
  callingSheetSourceSchema.parse({
    id: row.id,
    spreadsheetId: row.spreadsheet_id,
    label: row.label,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

const extractGoogleSpreadsheetId = (value: string) => {
  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return (match?.[1] ?? value).trim();
};

const isGoogleSpreadsheetId = (value: string) => /^[a-zA-Z0-9_-]{20,}$/.test(value);

const getConfiguredSpreadsheetIds = (sources: DbCallingSheetSourceRow[]) => [
  ...new Set([
    ...env.googleProspectsSheetIds,
    ...sources.map((source) => source.spreadsheet_id),
  ]),
];

const dedupeSheetProspects = (prospects: SheetProspect[]) => {
  const seenExternalIds = new Set<string>();
  const deduped: SheetProspect[] = [];
  let skipped = 0;

  for (const prospect of prospects) {
    if (seenExternalIds.has(prospect.externalId)) {
      skipped += 1;
      continue;
    }

    seenExternalIds.add(prospect.externalId);
    deduped.push(prospect);
  }

  return { prospects: deduped, skipped };
};

const getCallingWorkspace = async () => {
  const [prospects, batches, calls, externalCalls, sheetSources, lastSheetSyncAt] =
    await Promise.all([
      storage.listCallingProspects(),
      storage.listCallingBatches(25),
      storage.listCallingCalls(300),
      storage.listCallingExternalCalls(100),
      storage.listCallingSheetSources(),
      storage.getLastCallingSheetSyncAt(),
    ]);
  const transcriptTurns = await storage.listCallingTranscriptTurns(
    externalCalls.map((call) => call.vapi_call_id),
  );
  const turnsByCallId = new Map<string, DbCallingTranscriptTurnRow[]>();

  for (const turn of transcriptTurns) {
    const turns = turnsByCallId.get(turn.vapi_call_id) ?? [];
    turns.push(turn);
    turnsByCallId.set(turn.vapi_call_id, turns);
  }

  return callingWorkspaceResponseSchema.parse({
    prospects: prospects.map(toCallingProspect),
    batches: batches.map(toCallingBatch),
    calls: calls.map(toCallingCall),
    externalCalls: externalCalls.map((call) =>
      toCallingExternalCall(call, turnsByCallId.get(call.vapi_call_id) ?? []),
    ),
    sheetSources: sheetSources.map(toCallingSheetSource),
    webhookConfigured: Boolean(env.callingWebhookUrl),
    vapiEventsConfigured: Boolean(env.vapiEventSecret),
    sheetConfigured: getConfiguredSpreadsheetIds(sheetSources).length > 0,
    lastSheetSyncAt,
  });
};

const persistFinalTranscriptTurn = async (
  input: {
    vapiCallId: string;
    eventIdentity: string;
    role: DbCallingTranscriptRole;
    transcript: string;
    occurredAt: string;
    sequenceIndex: number;
  },
  storageAdapter: StorageAdapter,
) => {
  const transcript = input.transcript.trim();
  if (!transcript) {
    return false;
  }

  const eventKey = eventKeyFor(
    input.vapiCallId,
    input.eventIdentity,
    input.role,
    transcript,
  );
  const inserted = await storageAdapter.insertCallingTranscriptTurn({
    id: eventKey.slice(0, 24),
    vapi_call_id: input.vapiCallId,
    event_key: eventKey,
    role: input.role,
    transcript,
    occurred_at: input.occurredAt,
    sequence_index: input.sequenceIndex,
    created_at: new Date().toISOString(),
  });

  await storageAdapter.updateCallingExternalTranscript(input.vapiCallId, {
    partialRole: null,
    partialTranscript: null,
    partialUpdatedAt: null,
    lastFinalAt: input.occurredAt,
  });
  return inserted;
};

export const ingestVapiServerEvent = async (
  body: unknown,
  storageAdapter: StorageAdapter = storage,
) => {
  const event = vapiServerEventSchema.parse(body);
  const message = event.message;
  const rawMessage = asRecord(message);
  const call = message.call;
  const metadata = call.metadata ?? {};
  const existing = await storageAdapter.findCallingExternalCallById(call.id);
  const now = new Date().toISOString();
  const occurredAt = normalizeTimestamp(
    message.timestamp ?? call.endedAt ?? call.startedAt ?? call.createdAt,
    now,
  );
  const isTranscript = message.type === "transcript" || message.type.startsWith("transcript[");
  const isEndReport = message.type === "end-of-call-report";
  const rawStatus = rawMessage.status ?? call.status;
  let status = normalizeExternalStatus(rawStatus, existing?.status ?? "queued");

  if (isTranscript && activeExternalCallStatuses.has(status)) {
    status = "in_progress";
  }

  const endedReason =
    readString(rawMessage, "endedReason") ?? call.endedReason ?? null;
  if (isEndReport) {
    status = endedReason && /fail|error/i.test(endedReason) ? "failed" : "ended";
  }

  if (existing && !activeExternalCallStatuses.has(existing.status) && !isEndReport) {
    status = existing.status;
  }

  const analysis = asRecord(message.analysis);
  const summary = readString(analysis, "summary") ?? existing?.summary ?? null;
  const outcome =
    readString(analysis, "successEvaluation", "outcome") ??
    endedReason ??
    existing?.outcome ??
    null;
  const phone =
    readString(metadata, "phone", "public_phone", "customer_phone") ??
    call.customer?.number?.trim() ??
    existing?.phone ??
    "";
  const companyName =
    readString(metadata, "company_name", "companyName", "company") ??
    existing?.company_name ??
    "Unknown company";
  const leadName =
    readString(metadata, "lead_name", "leadName", "contact_name", "name") ??
    existing?.lead_name ??
    companyName;
  const report = isEndReport
    ? {
        artifact: message.artifact ?? null,
        analysis: message.analysis ?? null,
        endedReason,
      }
    : existing?.report_json
      ? JSON.parse(existing.report_json) as Record<string, unknown>
      : null;

  const row: DbCallingExternalCallRow = {
    vapi_call_id: call.id,
    source:
      readString(metadata, "source") ?? existing?.source ?? "opsui_cold_leads",
    lead_external_id:
      readString(
        metadata,
        "lead_external_id",
        "leadExternalId",
        "sheet_row_id",
        "sheetRowId",
        "row_number",
      ) ?? existing?.lead_external_id ?? null,
    lead_name: leadName,
    company_name: companyName,
    phone,
    context_json: Object.keys(metadata).length
      ? JSON.stringify(metadata)
      : existing?.context_json ?? "{}",
    status,
    outcome,
    summary,
    report_json: report ? JSON.stringify(report) : null,
    partial_role: existing?.partial_role ?? null,
    partial_transcript: existing?.partial_transcript ?? null,
    partial_updated_at: existing?.partial_updated_at ?? null,
    last_final_at: existing?.last_final_at ?? null,
    started_at: call.startedAt
      ? normalizeTimestamp(call.startedAt, existing?.started_at ?? occurredAt)
      : existing?.started_at ?? (isTranscript ? occurredAt : null),
    ended_at: isEndReport
      ? normalizeTimestamp(call.endedAt, occurredAt)
      : existing?.ended_at ?? null,
    created_at: normalizeTimestamp(call.createdAt, existing?.created_at ?? now),
    updated_at: now,
  };

  await storageAdapter.upsertCallingExternalCall(row);

  let insertedTurns = 0;
  if (isTranscript) {
    const role = normalizeTranscriptRole(message.role);
    const transcript = message.transcript?.trim() ?? "";
    const transcriptType = message.type.includes("final")
      ? "final"
      : message.transcriptType?.toLowerCase();

    if (
      role &&
      transcript &&
      transcriptType === "partial" &&
      activeExternalCallStatuses.has(status)
    ) {
      await storageAdapter.updateCallingExternalTranscript(call.id, {
        partialRole: role,
        partialTranscript: transcript,
        partialUpdatedAt: occurredAt,
      });
    } else if (role && transcript && transcriptType === "final") {
      const sequenceIndex = message.turn !== undefined
        ? message.turn * 1000
        : Math.max(0, Date.parse(occurredAt) * 1000);
      const inserted = await persistFinalTranscriptTurn({
        vapiCallId: call.id,
        eventIdentity:
          message.eventId ?? `${message.turn ?? ""}:${occurredAt}`,
        role,
        transcript,
        occurredAt,
        sequenceIndex,
      }, storageAdapter);
      insertedTurns += inserted ? 1 : 0;
    }
  }

  if (isEndReport) {
    const artifact = asRecord(message.artifact);
    const artifactMessages = Array.isArray(artifact.messages) ? artifact.messages : [];
    const knownTurns = await storageAdapter.listCallingTranscriptTurns([call.id]);

    for (const [index, candidate] of artifactMessages.entries()) {
      const artifactMessage = asRecord(candidate);
      const role = normalizeTranscriptRole(artifactMessage.role);
      const transcript = readString(artifactMessage, "message", "transcript", "content");
      if (!role || !transcript) {
        continue;
      }

      const secondsFromStart =
        typeof artifactMessage.secondsFromStart === "number"
          ? artifactMessage.secondsFromStart
          : index;
      const baseTime = new Date(row.started_at ?? occurredAt).getTime();
      const turnAt = new Date(baseTime + secondsFromStart * 1000).toISOString();
      const duplicateLiveTurn = knownTurns.some(
        (turn) =>
          turn.role === role &&
          turn.transcript === transcript &&
          Math.abs(new Date(turn.occurred_at).getTime() - new Date(turnAt).getTime()) <= 2_000,
      );
      if (duplicateLiveTurn) {
        continue;
      }
      const inserted = await persistFinalTranscriptTurn({
        vapiCallId: call.id,
        eventIdentity: `artifact:${index}:${secondsFromStart}`,
        role,
        transcript,
        occurredAt: turnAt,
        sequenceIndex: Math.max(0, baseTime * 1000 + Math.round(secondsFromStart * 1000)),
      }, storageAdapter);
      insertedTurns += inserted ? 1 : 0;
    }
  }

  return {
    accepted: true,
    type: message.type,
    vapiCallId: call.id,
    insertedTurns,
  };
};

const buildBatchResponse = async (
  batchId: string,
  startedCallId: string | null,
) => {
  const batch = await storage.findCallingBatchById(batchId);

  if (!batch) {
    throw new Error("Calling batch could not be loaded.");
  }

  const calls = await storage.listCallingCallsByBatch(batchId);

  return callingBatchStartResponseSchema.parse({
    batch: toCallingBatch(batch),
    calls: calls.map(toCallingCall),
    startedCallId,
  });
};

const toRequestedBy = async (batch: DbCallingBatchRow) => {
  const user = await storage.findUserById(batch.created_by_user_id);

  if (!user) {
    return {
      id: batch.created_by_user_id,
      username: "unknown",
      displayName: "Unknown user",
      role: "member",
    };
  }

  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
  };
};

const parseWebhookExternalCallId = async (response: Response) => {
  const text = await response.text().catch(() => "");

  if (!text) {
    return null;
  }

  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    const externalCallId =
      payload.externalCallId ?? payload.callId ?? payload.id ?? null;

    return typeof externalCallId === "string" && externalCallId.trim()
      ? externalCallId.trim()
      : null;
  } catch {
    return null;
  }
};

const triggerCallingWebhook = async (
  call: DbCallingCallRow,
  prospect: DbCallingProspectRow,
  batch: DbCallingBatchRow,
  requestedBy: Awaited<ReturnType<typeof toRequestedBy>> | AuthUser,
  test:
    | { mode: "phone"; phone: string }
    | { mode: "mr_tester"; testCase: string }
    | null = null,
) => {
  if (!env.callingWebhookUrl) {
    throw new Error("Calling webhook is not configured.");
  }

  if (!env.callingWebhookSecret) {
    throw new Error("Calling webhook secret is not configured.");
  }

  const publicApiBase = env.socialPublicApiUrl.replace(/\/$/, "");
  const callbackPath = `/calling/calls/${encodeURIComponent(call.id)}/complete`;
  const response = await fetch(env.callingWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Calling-Secret": env.callingWebhookSecret,
    },
    body: JSON.stringify({
      type: "prospect_call",
      idempotencyKey: call.id,
      callId: call.id,
      batchId: batch.id,
      sequenceIndex: call.sequence_index,
      prospect: {
        id: prospect.id,
        name: prospect.name,
        phone: prospect.phone,
        companyName: prospect.company_name,
        email: prospect.email,
        notes: prospect.notes,
        source: prospect.source,
        externalId: prospect.external_id,
      },
      requestedBy,
      test,
      callback: {
        url: publicApiBase ? `${publicApiBase}${callbackPath}` : null,
        path: callbackPath,
        secret: env.callingWebhookSecret,
      },
      requestedAt: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(
      `Calling webhook failed with status ${response.status}${
        responseText ? `: ${responseText}` : ""
      }`,
    );
  }

  return parseWebhookExternalCallId(response);
};

const startCallingCall = async (
  callId: string,
  test:
    | { mode: "phone"; phone: string }
    | { mode: "mr_tester"; testCase: string }
    | null = null,
) => {
  const call = await storage.findCallingCallById(callId);

  if (!call) {
    throw new Error("Call run not found.");
  }

  if (call.status !== "queued") {
    return call;
  }

  const [prospect, batch] = await Promise.all([
    storage.findCallingProspectById(call.prospect_id),
    storage.findCallingBatchById(call.batch_id),
  ]);

  if (!prospect || !batch) {
    throw new Error("Call run is missing its prospect or batch.");
  }

  const now = new Date().toISOString();
  await storage.updateCallingBatchStatus(batch.id, {
    status: "running",
    startedAt: batch.started_at ?? now,
  });
  await storage.updateCallingProspectStatus(prospect.id, {
    status: "calling",
    lastCallAt: now,
  });
  const updatedCall =
    (await storage.updateCallingCallStatus(call.id, {
      status: "calling",
      startedAt: now,
      statusMessage: null,
    })) ?? call;

  try {
    const externalCallId = await triggerCallingWebhook(
      updatedCall,
      prospect,
      batch,
      await toRequestedBy(batch),
      test,
    );

    if (!externalCallId) {
      return updatedCall;
    }

    return (
      (await storage.updateCallingCallStatus(call.id, {
        status: "calling",
        externalCallId,
        statusMessage: null,
      })) ?? updatedCall
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Calling webhook failed.";
    const failedAt = new Date().toISOString();
    await storage.updateCallingCallStatus(call.id, {
      status: "failed",
      outcome: "failed",
      completedAt: failedAt,
      statusMessage: message,
    });
    await storage.updateCallingProspectStatus(prospect.id, {
      status: "failed",
      lastCallAt: failedAt,
      lastCallOutcome: "failed",
    });
    await storage.updateCallingBatchStatus(batch.id, {
      status: "failed",
    });
    throw error;
  }
};

const completeCallingCall = async (
  callId: string,
  input: z.infer<typeof callingCallCompletionInputSchema>,
) => {
  const call = await storage.findCallingCallById(callId);

  if (!call) {
    throw new Error("Call run not found.");
  }

  if (terminalCallStatuses.has(call.status)) {
    return buildBatchResponse(call.batch_id, null);
  }

  const completedAt = new Date().toISOString();
  const outcome = input.outcome ?? input.status;
  await storage.updateCallingCallStatus(call.id, {
    status: input.status,
    outcome,
    notes: input.notes ?? "",
    durationSeconds: input.durationSeconds ?? null,
    externalCallId: input.externalCallId ?? input.makeExecutionId ?? null,
    completedAt,
    statusMessage: null,
  });
  await storage.updateCallingProspectStatus(call.prospect_id, {
    status: input.status === "completed" ? "completed" : "failed",
    lastCallAt: completedAt,
    lastCallOutcome: outcome,
  });

  const nextCall = await storage.findNextQueuedCallingCall(call.batch_id);

  if (nextCall) {
    const startedCall = await startCallingCall(nextCall.id);
    return buildBatchResponse(call.batch_id, startedCall.id);
  }

  const calls = await storage.listCallingCallsByBatch(call.batch_id);
  const allCallsFinished = calls.every((candidate) =>
    terminalCallStatuses.has(candidate.status),
  );

  if (allCallsFinished) {
    await storage.updateCallingBatchStatus(call.batch_id, {
      status: "completed",
      completedAt,
    });
  }

  return buildBatchResponse(call.batch_id, null);
};

export const registerCallingRoutes = (app: import("fastify").FastifyInstance) => {
  app.get(
    "/calling",
    { preHandler: [authenticateRequest] },
    async () => getCallingWorkspace(),
  );

  app.post(
    "/calling/prospects",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const currentUser = request.user;

      if (!currentUser) {
        return reply.unauthorized("Missing authenticated user");
      }

      const input = createCallingProspectInputSchema.parse(request.body);
      const now = new Date().toISOString();
      const row: DbCallingProspectRow = {
        id: nanoid(),
        name: input.name.trim(),
        phone: input.phone.trim(),
        company_name: input.companyName.trim(),
        email: input.email?.trim() || null,
        notes: input.notes.trim(),
        source: "manual",
        external_id: null,
        status: "new",
        last_call_at: null,
        last_call_outcome: null,
        created_by_user_id: currentUser.id,
        created_at: now,
        updated_at: now,
      };

      await storage.insertCallingProspect(row);

      return toCallingProspect(row);
    },
  );

  app.post("/calling/vapi-events", async (request, reply) => {
    if (!env.vapiEventSecret) {
      return reply.serviceUnavailable("Vapi event ingestion is not configured.");
    }

    const suppliedSecret = request.headers["x-calling-secret"];
    if (typeof suppliedSecret !== "string" || suppliedSecret !== env.vapiEventSecret) {
      return reply.unauthorized("Invalid calling event secret.");
    }

    return ingestVapiServerEvent(request.body);
  });

  app.post(
    "/calling/sheets",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const currentUser = request.user;

      if (!currentUser) {
        return reply.unauthorized("Missing authenticated user");
      }

      const input = createCallingSheetSourceInputSchema.parse(request.body);
      const spreadsheetId = extractGoogleSpreadsheetId(input.urlOrId);

      if (!isGoogleSpreadsheetId(spreadsheetId)) {
        return reply.badRequest("Enter a valid Google Sheets URL or document ID.");
      }

      const existing = (await storage.listCallingSheetSources()).find(
        (source) => source.spreadsheet_id === spreadsheetId,
      );

      if (existing) {
        return toCallingSheetSource(existing);
      }

      const now = new Date().toISOString();
      const row: DbCallingSheetSourceRow = {
        id: nanoid(),
        spreadsheet_id: spreadsheetId,
        label: input.label?.trim() || `Sheet ${spreadsheetId.slice(0, 8)}`,
        created_by_user_id: currentUser.id,
        created_at: now,
        updated_at: now,
      };

      await storage.insertCallingSheetSource(row);

      return toCallingSheetSource(row);
    },
  );

  app.delete(
    "/calling/sheets/:id",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const deleted = await storage.deleteCallingSheetSource(id);

      if (!deleted) {
        return reply.notFound("Sheet source not found.");
      }

      return reply.status(204).send();
    },
  );

  app.post(
    "/calling/sync",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const currentUser = request.user;

      if (!currentUser) {
        return reply.unauthorized("Missing authenticated user");
      }

      const sheetSources = await storage.listCallingSheetSources();
      const spreadsheetIds = getConfiguredSpreadsheetIds(sheetSources);

      if (!spreadsheetIds.length) {
        return reply.serviceUnavailable(
          "Google prospects sheet is not configured.",
        );
      }

      const fetchedProspects = await fetchGoogleSheetProspects(spreadsheetIds);
      const { prospects, skipped } = dedupeSheetProspects(fetchedProspects);
      const now = new Date().toISOString();
      const result = await storage.upsertCallingProspects(
        prospects.map((prospect) => ({
          id: nanoid(),
          name: prospect.name,
          phone: prospect.phone,
          company_name: prospect.companyName,
          email: prospect.email,
          notes: prospect.notes,
          source: "google_sheet",
          external_id: prospect.externalId,
          status: "new",
          last_call_at: null,
          last_call_outcome: null,
          created_by_user_id: currentUser.id,
          created_at: now,
          updated_at: now,
        })),
      );

      return callingProspectsSyncResponseSchema.parse({
        ...result,
        skipped: result.skipped + skipped,
      });
    },
  );

  app.post(
    "/calling/test-call",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const currentUser = request.user;

      if (!currentUser) {
        return reply.unauthorized("Missing authenticated user");
      }

      if (!env.callingWebhookUrl) {
        return reply.serviceUnavailable("Calling webhook is not configured.");
      }

      if (!env.callingWebhookSecret) {
        return reply.serviceUnavailable(
          "Calling webhook secret is not configured.",
        );
      }

      const input = createCallingTestCallInputSchema.parse(request.body);
      const createdAt = new Date().toISOString();
      const isMrTester = input.mode === "mr_tester";
      const prospect: DbCallingProspectRow = {
        id: nanoid(),
        name: isMrTester ? "Mr Tester scenario" : "Transcript test",
        phone: isMrTester ? "vapi:mr-tester" : input.phone,
        company_name: "OpsUI testing",
        email: null,
        notes: isMrTester
          ? input.testCase
          : "Created by the saved-number test call control.",
        source: "manual",
        external_id: isMrTester ? "vapi-assistant:mr-tester" : null,
        status: "new",
        last_call_at: null,
        last_call_outcome: null,
        created_by_user_id: currentUser.id,
        created_at: createdAt,
        updated_at: createdAt,
      };
      const batch: DbCallingBatchRow = {
        id: nanoid(),
        status: "queued",
        total_count: 1,
        created_by_user_id: currentUser.id,
        created_at: createdAt,
        started_at: null,
        completed_at: null,
      };
      const call: DbCallingCallRow = {
        id: nanoid(),
        batch_id: batch.id,
        prospect_id: prospect.id,
        sequence_index: 0,
        status: "queued",
        outcome: null,
        notes: isMrTester ? input.testCase : "",
        duration_seconds: null,
        external_call_id: null,
        status_message: null,
        created_at: createdAt,
        started_at: null,
        completed_at: null,
        updated_at: createdAt,
      };

      await storage.insertCallingProspect(prospect);
      await storage.insertCallingBatch(batch, [call]);
      const startedCall = await startCallingCall(call.id, input);

      return buildBatchResponse(batch.id, startedCall.id);
    },
  );

  app.post(
    "/calling/batches",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const currentUser = request.user;

      if (!currentUser) {
        return reply.unauthorized("Missing authenticated user");
      }

      if (!env.callingWebhookUrl) {
        return reply.serviceUnavailable("Calling webhook is not configured.");
      }

      if (!env.callingWebhookSecret) {
        return reply.serviceUnavailable(
          "Calling webhook secret is not configured.",
        );
      }

      const input = createCallingBatchInputSchema.parse(request.body);
      const prospectIds = [...new Set(input.prospectIds)];
      const prospects = await Promise.all(
        prospectIds.map((id) => storage.findCallingProspectById(id)),
      );
      const missingProspect = prospects.find((prospect) => !prospect);

      if (missingProspect === null) {
        return reply.notFound("One or more prospects could not be found.");
      }

      const selectedProspects = prospects.filter(
        (prospect): prospect is DbCallingProspectRow => Boolean(prospect),
      );
      const unavailableProspect = selectedProspects.find((prospect) =>
        ["queued", "calling", "do_not_call"].includes(prospect.status),
      );

      if (unavailableProspect) {
        return reply.badRequest(
          `${unavailableProspect.name} is already queued, calling, or marked do not call.`,
        );
      }

      const createdAt = new Date().toISOString();
      const batch: DbCallingBatchRow = {
        id: nanoid(),
        status: "queued",
        total_count: selectedProspects.length,
        created_by_user_id: currentUser.id,
        created_at: createdAt,
        started_at: null,
        completed_at: null,
      };
      const calls: DbCallingCallRow[] = selectedProspects.map(
        (prospect, index) => ({
          id: nanoid(),
          batch_id: batch.id,
          prospect_id: prospect.id,
          sequence_index: index,
          status: "queued",
          outcome: null,
          notes: "",
          duration_seconds: null,
          external_call_id: null,
          status_message: null,
          created_at: createdAt,
          started_at: null,
          completed_at: null,
          updated_at: createdAt,
        }),
      );

      await storage.insertCallingBatch(batch, calls);
      const startedCall = await startCallingCall(calls[0].id);

      return buildBatchResponse(batch.id, startedCall.id);
    },
  );

  app.post(
    "/calling/batches/:id/start-next",
    { preHandler: [authenticateRequest] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const batch = await storage.findCallingBatchById(id);

      if (!batch) {
        return reply.notFound("Calling batch not found.");
      }

      const nextCall = await storage.findNextQueuedCallingCall(batch.id);

      if (!nextCall) {
        return buildBatchResponse(batch.id, null);
      }

      const startedCall = await startCallingCall(nextCall.id);

      return buildBatchResponse(batch.id, startedCall.id);
    },
  );

  app.post("/calling/calls/:id/complete", async (request, reply) => {
    if (!env.callingWebhookSecret) {
      return reply.serviceUnavailable("Calling callback secret is not configured.");
    }

    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = callingCallCompletionInputSchema.parse(request.body ?? {});
    const headerSecret = request.headers["x-calling-secret"];
    const suppliedSecret =
      typeof headerSecret === "string" ? headerSecret : input.secret;

    if (suppliedSecret !== env.callingWebhookSecret) {
      return reply.unauthorized("Invalid calling callback secret.");
    }

    return completeCallingCall(id, input);
  });
};

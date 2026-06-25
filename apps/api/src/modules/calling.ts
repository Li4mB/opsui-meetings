import {
  callingBatchStartResponseSchema,
  callingCallCompletionInputSchema,
  callingCallSchema,
  callingProspectSchema,
  callingProspectsSyncResponseSchema,
  callingSheetSourceSchema,
  callingWorkspaceResponseSchema,
  createCallingBatchInputSchema,
  createCallingProspectInputSchema,
  createCallingSheetSourceInputSchema,
} from "@opsui/shared";
import { nanoid } from "nanoid";
import { z } from "zod";
import { env } from "../config/env.js";
import { storage } from "../db/database.js";
import { authenticateRequest } from "./auth.js";
import {
  fetchGoogleSheetProspects,
  type SheetProspect,
} from "./google-sheets-prospects.js";
import type {
  AuthUser,
  DbCallingBatchRow,
  DbCallingCallRow,
  DbCallingProspectRow,
  DbCallingSheetSourceRow,
} from "../types.js";

const terminalCallStatuses = new Set([
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);

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
  const [prospects, batches, calls, sheetSources, lastSheetSyncAt] =
    await Promise.all([
    storage.listCallingProspects(),
    storage.listCallingBatches(25),
    storage.listCallingCalls(300),
    storage.listCallingSheetSources(),
    storage.getLastCallingSheetSyncAt(),
  ]);

  return callingWorkspaceResponseSchema.parse({
    prospects: prospects.map(toCallingProspect),
    batches: batches.map(toCallingBatch),
    calls: calls.map(toCallingCall),
    sheetSources: sheetSources.map(toCallingSheetSource),
    webhookConfigured: Boolean(env.callingWebhookUrl),
    sheetConfigured: getConfiguredSpreadsheetIds(sheetSources).length > 0,
    lastSheetSyncAt,
  });
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
    headers: { "Content-Type": "application/json" },
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

const startCallingCall = async (callId: string) => {
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

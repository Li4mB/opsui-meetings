import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CallingBatch,
  CallingCall,
  CallingExternalCall,
  CallingProspect,
  CallingProspectStatus,
  CallingSheetSource,
  CallingTestMode,
  CallingWorkspaceResponse,
} from "@opsui/shared";
import {
  ApiError,
  createCallingBatch,
  createCallingProspect,
  createCallingSheetSource,
  createCallingTestCall,
  deleteCallingSheetSource,
  getCallingWorkspace,
  startNextCallingBatchCall,
  syncCallingProspects,
} from "../lib/api";

type Props = {
  authToken: string;
};

type CallingTab = "prospects" | "queue" | "sheets" | "add";
type ProspectFilter = "all" | CallingProspectStatus;

const statusLabels: Record<CallingProspectStatus, string> = {
  new: "New",
  queued: "Queued",
  calling: "Calling",
  completed: "Completed",
  failed: "Failed",
  do_not_call: "Do not call",
};

const callStatusLabels: Record<CallingCall["status"], string> = {
  queued: "Queued",
  calling: "Calling",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
  cancelled: "Cancelled",
};

const emptyProspects: CallingProspect[] = [];
const emptyBatches: CallingBatch[] = [];
const emptyCalls: CallingCall[] = [];
const emptyExternalCalls: CallingExternalCall[] = [];
const emptySheetSources: CallingSheetSource[] = [];
const testPhoneStorageKey = "opsui.calling.test-phone";
const testCaseStorageKey = "opsui.calling.mr-tester-case";
const testModeStorageKey = "opsui.calling.test-mode";

const getSavedValue = (key: string) => {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};

const saveValue = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A blocked local store should not prevent a test call from being sent.
  }
};

const getSavedTestMode = (): CallingTestMode =>
  getSavedValue(testModeStorageKey) === "mr_tester" ? "mr_tester" : "phone";

const formatDateTime = (value: string | null) => {
  if (!value) {
    return "Not yet";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
};

const formatTranscriptTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));

const externalCallStatusLabels: Record<CallingExternalCall["status"], string> = {
  queued: "Queued",
  ringing: "Ringing",
  in_progress: "Live",
  ended: "Ended",
  failed: "Failed",
};

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof ApiError || error instanceof Error ? error.message : fallback;

const prospectCanBeQueued = (prospect: CallingProspect) =>
  prospect.status !== "queued" &&
  prospect.status !== "calling" &&
  prospect.status !== "do_not_call";

const getBatchProgress = (batch: CallingBatch | null, calls: CallingCall[]) => {
  if (!batch || batch.totalCount === 0) {
    return 0;
  }

  const finished = calls.filter((call) =>
    ["completed", "failed", "skipped", "cancelled"].includes(call.status),
  ).length;

  return Math.round((finished / batch.totalCount) * 100);
};

export const CallingPanel = ({ authToken }: Props) => {
  const [workspace, setWorkspace] = useState<CallingWorkspaceResponse | null>(null);
  const [activeTab, setActiveTab] = useState<CallingTab>("prospects");
  const [selectedExternalCallId, setSelectedExternalCallId] = useState<string | null>(null);
  const [selectedProspectIds, setSelectedProspectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProspectFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testMode, setTestMode] = useState<CallingTestMode>(getSavedTestMode);
  const [testPhone, setTestPhone] = useState(() => getSavedValue(testPhoneStorageKey));
  const [testCase, setTestCase] = useState(() => getSavedValue(testCaseStorageKey));
  const [form, setForm] = useState({
    name: "",
    phone: "",
    companyName: "",
    email: "",
    notes: "",
  });
  const [sheetForm, setSheetForm] = useState({
    urlOrId: "",
    label: "",
  });

  const refreshWorkspace = useCallback(async (quiet = false) => {
    if (!quiet) {
      setIsLoading(true);
    }
    setError(null);

    try {
      setWorkspace(await getCallingWorkspace(authToken));
    } catch (loadError) {
      setError(getErrorMessage(loadError, "Unable to load calling workspace."));
    } finally {
      setIsLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);

  const prospects = workspace?.prospects ?? emptyProspects;
  const batches = workspace?.batches ?? emptyBatches;
  const calls = workspace?.calls ?? emptyCalls;
  const externalCalls = workspace?.externalCalls ?? emptyExternalCalls;
  const sheetSources = workspace?.sheetSources ?? emptySheetSources;
  const hasActiveExternalCall = externalCalls.some((call) =>
    ["queued", "ringing", "in_progress"].includes(call.status),
  );
  const activeExternalCallCount = externalCalls.filter((call) =>
    ["queued", "ringing", "in_progress"].includes(call.status),
  ).length;
  const selectedExternalCall =
    externalCalls.find((call) => call.vapiCallId === selectedExternalCallId) ??
    externalCalls[0] ??
    null;
  const selectedCallIsMrTester = selectedExternalCall?.source === "opsui_mr_tester";
  const latestBatch = batches[0] ?? null;
  const activeBatch =
    batches.find((batch) => batch.status === "running" || batch.status === "queued") ??
    latestBatch;
  const activeBatchCalls = activeBatch
    ? calls
        .filter((call) => call.batchId === activeBatch.id)
        .sort((left, right) => left.sequenceIndex - right.sequenceIndex)
    : [];
  const activeCall = activeBatchCalls.find((call) => call.status === "calling") ?? null;
  const queuedCalls = activeBatchCalls.filter((call) => call.status === "queued");
  const progress = getBatchProgress(activeBatch, activeBatchCalls);
  const prospectsById = useMemo(
    () => new Map(prospects.map((prospect) => [prospect.id, prospect])),
    [prospects],
  );

  useEffect(() => {
    if (!externalCalls.length) {
      setSelectedExternalCallId(null);
      return;
    }

    if (!externalCalls.some((call) => call.vapiCallId === selectedExternalCallId)) {
      const preferred =
        externalCalls.find((call) => call.status === "in_progress") ?? externalCalls[0];
      setSelectedExternalCallId(preferred.vapiCallId);
    }
  }, [externalCalls, selectedExternalCallId]);

  useEffect(() => {
    if (activeTab !== "queue" || !hasActiveExternalCall) {
      return undefined;
    }

    let cancelled = false;
    let requestInFlight = false;
    const poll = async () => {
      if (cancelled || requestInFlight || document.visibilityState === "hidden") {
        return;
      }
      requestInFlight = true;
      try {
        await refreshWorkspace(true);
      } finally {
        requestInFlight = false;
      }
    };
    const interval = window.setInterval(() => void poll(), 1_500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeTab, hasActiveExternalCall, refreshWorkspace]);
  const selectedProspects = [...selectedProspectIds]
    .map((id) => prospectsById.get(id))
    .filter((prospect): prospect is CallingProspect => Boolean(prospect));
  const normalizedQuery = query.trim().toLowerCase();
  const filteredProspects = prospects.filter((prospect) => {
    if (filter !== "all" && prospect.status !== filter) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return [
      prospect.name,
      prospect.phone,
      prospect.companyName,
      prospect.email ?? "",
      prospect.notes,
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
  const callableCount = prospects.filter(prospectCanBeQueued).length;
  const completedCount = prospects.filter(
    (prospect) => prospect.status === "completed",
  ).length;
  const queuedCount = prospects.filter(
    (prospect) => prospect.status === "queued" || prospect.status === "calling",
  ).length;

  const toggleProspect = (prospect: CallingProspect) => {
    if (!prospectCanBeQueued(prospect)) {
      return;
    }

    setSelectedProspectIds((current) => {
      const next = new Set(current);

      if (next.has(prospect.id)) {
        next.delete(prospect.id);
      } else {
        next.add(prospect.id);
      }

      return next;
    });
  };

  const selectVisibleProspects = () => {
    setSelectedProspectIds(
      new Set(
        filteredProspects
          .filter(prospectCanBeQueued)
          .map((prospect) => prospect.id),
      ),
    );
  };

  const handleSyncProspects = async () => {
    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      const result = await syncCallingProspects(authToken);
      await refreshWorkspace(true);
      setMessage(
        `Sheet sync imported ${result.imported} and updated ${result.updated}.`,
      );
    } catch (syncError) {
      setError(getErrorMessage(syncError, "Unable to sync prospects."));
    } finally {
      setIsBusy(false);
    }
  };

  const handleStartBatch = async () => {
    if (!selectedProspects.length) {
      setError("Select at least one prospect to start a batch.");
      return;
    }

    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      await createCallingBatch(authToken, {
        prospectIds: selectedProspects.map((prospect) => prospect.id),
      });
      setSelectedProspectIds(new Set());
      await refreshWorkspace(true);
      setActiveTab("queue");
      setMessage("Batch started. Waiting for Make to confirm the call outcome.");
    } catch (batchError) {
      setError(getErrorMessage(batchError, "Unable to start the batch."));
      await refreshWorkspace(true);
    } finally {
      setIsBusy(false);
    }
  };

  const handleStartNext = async () => {
    if (!activeBatch) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      await startNextCallingBatchCall(authToken, activeBatch.id);
      await refreshWorkspace(true);
      setMessage("Next queued call has been sent to Make.");
    } catch (startError) {
      setError(getErrorMessage(startError, "Unable to start the next call."));
      await refreshWorkspace(true);
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateProspect = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      const created = await createCallingProspect(authToken, {
        name: form.name.trim(),
        phone: form.phone.trim(),
        companyName: form.companyName.trim(),
        email: form.email.trim() || null,
        notes: form.notes.trim(),
      });

      setForm({
        name: "",
        phone: "",
        companyName: "",
        email: "",
        notes: "",
      });
      await refreshWorkspace(true);
      setSelectedProspectIds(new Set([created.id]));
      setActiveTab("prospects");
      setMessage(`${created.name} is ready in the calling list.`);
    } catch (createError) {
      setError(getErrorMessage(createError, "Unable to add the prospect."));
    } finally {
      setIsBusy(false);
    }
  };

  const handleSendTestCall = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const phone = testPhone.trim();
    const instructions = testCase.trim();

    if (testMode === "phone" && phone.length < 6) {
      setError("Enter a valid phone number before sending the test call.");
      return;
    }

    if (testMode === "mr_tester" && instructions.length < 3) {
      setError("Describe the test case or instructions for Mr Tester.");
      return;
    }

    setIsBusy(true);
    setError(null);
    setMessage(null);
    saveValue(testModeStorageKey, testMode);

    try {
      await createCallingTestCall(
        authToken,
        testMode === "mr_tester"
          ? { mode: "mr_tester", testCase: instructions }
          : { mode: "phone", phone },
      );
      await refreshWorkspace(true);
      setMessage(
        testMode === "mr_tester"
          ? "Mr Tester scenario started. Its conversation will appear in Live transcripts."
          : `Test call sent to ${phone}. This number is saved for next time.`,
      );
    } catch (testCallError) {
      setError(getErrorMessage(testCallError, "Unable to send the test call."));
      await refreshWorkspace(true);
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateSheetSource = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      const source = await createCallingSheetSource(authToken, {
        urlOrId: sheetForm.urlOrId.trim(),
        label: sheetForm.label.trim() || undefined,
      });

      setSheetForm({ urlOrId: "", label: "" });
      await refreshWorkspace(true);
      setMessage(`${source.label} is attached for future syncs.`);
    } catch (createError) {
      setError(getErrorMessage(createError, "Unable to attach the sheet."));
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteSheetSource = async (source: CallingSheetSource) => {
    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      await deleteCallingSheetSource(authToken, source.id);
      await refreshWorkspace(true);
      setMessage(`${source.label} was removed from future syncs.`);
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, "Unable to remove the sheet."));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <section className="calling-panel">
      <div className="calling-panel__header">
        <div>
          <div className="sidebar-section__label">Workspace</div>
          <h1 className="main-title">Calling</h1>
        </div>
        <div className="calling-panel__actions">
          <button
            className="header-action-button"
            disabled={isBusy || isLoading}
            onClick={() => void refreshWorkspace()}
            type="button"
          >
            Refresh
          </button>
          <button
            className="header-action-button header-action-button--primary"
            disabled={isBusy || !workspace?.sheetConfigured}
            onClick={() => void handleSyncProspects()}
            title={
              workspace?.sheetConfigured
                ? "Sync prospects from Google Sheets"
                : "Prospect sheet not configured yet"
            }
            type="button"
          >
            Sync Sheet
          </button>
        </div>
      </div>

      <div className="calling-summary-grid">
        <div className="calling-summary">
          <span>Ready</span>
          <strong>{callableCount}</strong>
        </div>
        <div className="calling-summary">
          <span>Queued</span>
          <strong>{queuedCount}</strong>
        </div>
        <div className="calling-summary">
          <span>Completed</span>
          <strong>{completedCount}</strong>
        </div>
        <div className="calling-summary">
          <span>Live calls</span>
          <strong>{activeExternalCallCount}</strong>
        </div>
        <div className="calling-summary">
          <span>Sheet</span>
          <strong>{workspace?.sheetConfigured ? "Linked" : "Pending"}</strong>
        </div>
      </div>

      {message ? <div className="calling-alert calling-alert--success">{message}</div> : null}
      {error ? <div className="calling-alert calling-alert--error">{error}</div> : null}

      <div className="calling-tabs" role="tablist" aria-label="Calling workflow">
        <button
          className={`calling-tab ${activeTab === "prospects" ? "calling-tab--active" : ""}`}
          onClick={() => setActiveTab("prospects")}
          type="button"
        >
          Prospects
        </button>
        <button
          className={`calling-tab ${activeTab === "queue" ? "calling-tab--active" : ""}`}
          onClick={() => setActiveTab("queue")}
          type="button"
        >
          Queue
        </button>
        <button
          className={`calling-tab ${activeTab === "sheets" ? "calling-tab--active" : ""}`}
          onClick={() => setActiveTab("sheets")}
          type="button"
        >
          Sheets
        </button>
        <button
          className={`calling-tab ${activeTab === "add" ? "calling-tab--active" : ""}`}
          onClick={() => setActiveTab("add")}
          type="button"
        >
          Add Prospect
        </button>
      </div>

      {isLoading ? (
        <div className="calling-empty">Loading calling workspace...</div>
      ) : activeTab === "prospects" ? (
        <div className="calling-prospects">
          <div className="calling-toolbar">
            <div className="calling-search">
              <span className="header-search__icon">/</span>
              <input
                aria-label="Search prospects"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search prospects, phone, company..."
                value={query}
              />
            </div>
            <select
              aria-label="Filter prospects by status"
              onChange={(event) => setFilter(event.target.value as ProspectFilter)}
              value={filter}
            >
              <option value="all">All statuses</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              className="header-action-button"
              onClick={selectVisibleProspects}
              type="button"
            >
              Select Visible
            </button>
            <button
              className="header-action-button"
              onClick={() => setSelectedProspectIds(new Set())}
              type="button"
            >
              Clear
            </button>
            <button
              className="header-action-button header-action-button--primary"
              disabled={
                isBusy ||
                !workspace?.webhookConfigured ||
                selectedProspects.length === 0
              }
              onClick={() => void handleStartBatch()}
              title={
                workspace?.webhookConfigured
                  ? "Start selected calls"
                  : "Calling webhook not configured yet"
              }
              type="button"
            >
              Start Batch ({selectedProspects.length})
            </button>
          </div>

          <div className="calling-table">
            <div className="calling-table__head">
              <span />
              <span>Prospect</span>
              <span>Company</span>
              <span>Phone</span>
              <span>Status</span>
              <span>Last call</span>
            </div>
            {filteredProspects.length ? (
              filteredProspects.map((prospect) => {
                const isSelected = selectedProspectIds.has(prospect.id);
                const canSelect = prospectCanBeQueued(prospect);

                return (
                  <button
                    className={`calling-row ${isSelected ? "calling-row--selected" : ""}`}
                    disabled={!canSelect}
                    key={prospect.id}
                    onClick={() => toggleProspect(prospect)}
                    type="button"
                  >
                    <span className="calling-row__check">
                      <input
                        aria-label={`Select ${prospect.name}`}
                        checked={isSelected}
                        disabled={!canSelect}
                        onChange={() => toggleProspect(prospect)}
                        onClick={(event) => event.stopPropagation()}
                        type="checkbox"
                      />
                    </span>
                    <span>
                      <strong>{prospect.name}</strong>
                      <small>{prospect.email ?? prospect.source.replace("_", " ")}</small>
                    </span>
                    <span>{prospect.companyName}</span>
                    <span className="calling-row__mono">{prospect.phone}</span>
                    <span>
                      <span className={`calling-status calling-status--${prospect.status}`}>
                        {statusLabels[prospect.status]}
                      </span>
                    </span>
                    <span>{formatDateTime(prospect.lastCallAt)}</span>
                  </button>
                );
              })
            ) : (
              <div className="calling-empty">No prospects match the current view.</div>
            )}
          </div>
        </div>
      ) : activeTab === "queue" ? (
        <div className="calling-queue">
          <form
            className="calling-test-call"
            onSubmit={(event) => void handleSendTestCall(event)}
          >
            <div className="calling-test-call__copy">
              <div className="sidebar-section__label">Tester</div>
              <h2>{testMode === "mr_tester" ? "Run a voice-agent scenario" : "Send a test call"}</h2>
              <p>
                {testMode === "mr_tester"
                  ? "Mr Tester calls the OpsUI agent, follows your scenario, and streams both voices live."
                  : "Call your saved number through the live Make and Vapi workflow."}
              </p>
              <div className="calling-test-call__mode" aria-label="Test call mode">
                <span className={testMode === "phone" ? "is-active" : ""}>
                  Direct phone
                </span>
                <button
                  aria-checked={testMode === "mr_tester"}
                  aria-label={`Switch to ${testMode === "phone" ? "Mr Tester" : "direct phone"} mode`}
                  className="calling-test-call__switch"
                  onClick={() => {
                    const nextMode = testMode === "phone" ? "mr_tester" : "phone";
                    setTestMode(nextMode);
                    saveValue(testModeStorageKey, nextMode);
                    setError(null);
                    setMessage(null);
                  }}
                  role="switch"
                  type="button"
                >
                  <span aria-hidden="true">
                    <svg fill="none" viewBox="0 0 24 24">
                      <path d="M7 7h10m0 0-3-3m3 3-3 3M17 17H7m0 0 3 3m-3-3 3-3" />
                    </svg>
                  </span>
                </button>
                <span className={testMode === "mr_tester" ? "is-active" : ""}>
                  Mr Tester
                </span>
              </div>
            </div>
            <label
              className="calling-test-call__field"
              htmlFor={testMode === "mr_tester" ? "calling-test-case" : "calling-test-phone"}
            >
              <span>{testMode === "mr_tester" ? "Test case or instructions" : "Test phone number"}</span>
              <div className="calling-test-call__controls">
                {testMode === "mr_tester" ? (
                  <textarea
                    id="calling-test-case"
                    maxLength={4000}
                    onChange={(event) => {
                      setTestCase(event.target.value);
                      saveValue(testCaseStorageKey, event.target.value);
                    }}
                    placeholder="Example: Act interested at first, then raise a pricing objection and ask for a follow-up next Tuesday."
                    required
                    rows={4}
                    value={testCase}
                  />
                ) : (
                  <input
                    autoComplete="tel"
                    id="calling-test-phone"
                    maxLength={40}
                    onChange={(event) => {
                      setTestPhone(event.target.value);
                      saveValue(testPhoneStorageKey, event.target.value);
                    }}
                    placeholder="+61 4xx xxx xxx"
                    required
                    type="tel"
                    value={testPhone}
                  />
                )}
                <button
                  className="header-action-button header-action-button--primary"
                  disabled={
                    isBusy ||
                    !workspace?.webhookConfigured ||
                    (testMode === "phone"
                      ? testPhone.trim().length < 6
                      : testCase.trim().length < 3)
                  }
                  title={
                    workspace?.webhookConfigured
                      ? testMode === "mr_tester"
                        ? "Start this scenario with Mr Tester"
                        : "Send a test call to this number"
                      : "Calling webhook not configured yet"
                  }
                  type="submit"
                >
                  {isBusy
                    ? "Starting..."
                    : testMode === "mr_tester"
                      ? "Run scenario"
                      : "Send test call"}
                </button>
              </div>
              <small>
                {testMode === "mr_tester"
                  ? "This scenario is saved on this device and passed only to this call."
                  : "Saved on this device for repeat testing."}
              </small>
            </label>
          </form>

          <div className="calling-queue__hero">
            <div>
              <div className="sidebar-section__label">Active batch</div>
              <h2>{activeBatch ? activeBatch.status : "No batch"}</h2>
              <p>
                {activeCall
                  ? `Calling ${prospectsById.get(activeCall.prospectId)?.name ?? "prospect"}`
                  : queuedCalls.length
                    ? `${queuedCalls.length} calls waiting`
                    : "No queued calls waiting"}
              </p>
            </div>
            <button
              className="header-action-button header-action-button--primary"
              disabled={isBusy || !activeBatch || Boolean(activeCall) || !queuedCalls.length}
              onClick={() => void handleStartNext()}
              type="button"
            >
              Start Next
            </button>
          </div>

          <div className="calling-progress" aria-label="Batch progress">
            <span style={{ width: `${progress}%` }} />
          </div>

          <section className="calling-live" aria-labelledby="calling-live-heading">
            <div className="calling-live__heading">
              <div>
                <div className="sidebar-section__label">Vapi voice calls</div>
                <h2 id="calling-live-heading">Live transcripts</h2>
              </div>
              <span className="calling-live__connection">
                <span aria-hidden="true" className={hasActiveExternalCall ? "is-live" : ""} />
                {hasActiveExternalCall ? "Receiving events" : "No live calls"}
              </span>
            </div>

            {externalCalls.length ? (
              <div className="calling-live__layout">
                <div className="calling-live__calls" aria-label="Vapi voice calls">
                  {externalCalls.map((call) => (
                    <button
                      aria-pressed={call.vapiCallId === selectedExternalCall?.vapiCallId}
                      className={`calling-live__call ${
                        call.vapiCallId === selectedExternalCall?.vapiCallId
                          ? "calling-live__call--selected"
                          : ""
                      }`}
                      key={call.vapiCallId}
                      onClick={() => setSelectedExternalCallId(call.vapiCallId)}
                      type="button"
                    >
                      <span>
                        <strong>{call.leadName || call.companyName}</strong>
                        <small>{call.companyName || call.phone || "Cold lead"}</small>
                      </span>
                      <span className={`calling-status calling-status--${call.status}`}>
                        {externalCallStatusLabels[call.status]}
                      </span>
                      <time dateTime={call.updatedAt}>{formatDateTime(call.updatedAt)}</time>
                    </button>
                  ))}
                </div>

                {selectedExternalCall ? (
                  <div className="calling-transcript">
                    <div className="calling-transcript__header">
                      <div>
                        <strong>{selectedExternalCall.leadName}</strong>
                        <span>
                          {selectedExternalCall.companyName}
                          {selectedExternalCall.phone ? ` / ${selectedExternalCall.phone}` : ""}
                        </span>
                      </div>
                      <span className={`calling-status calling-status--${selectedExternalCall.status}`}>
                        {externalCallStatusLabels[selectedExternalCall.status]}
                      </span>
                    </div>

                    <div
                      aria-label={`Transcript for ${selectedExternalCall.leadName}`}
                      aria-live="polite"
                      className="calling-transcript__log"
                      role="log"
                    >
                      {selectedExternalCall.transcriptTurns.length ? (
                        selectedExternalCall.transcriptTurns.map((turn) => (
                          <div
                            className={`calling-transcript__turn calling-transcript__turn--${turn.role}`}
                            key={turn.id}
                          >
                            <div>
                              <strong>
                                {selectedCallIsMrTester
                                  ? turn.role === "assistant"
                                    ? "Mr Tester"
                                    : "OpsUI agent"
                                  : turn.role === "assistant"
                                    ? "OpsUI agent"
                                    : "Customer"}
                              </strong>
                              <time dateTime={turn.occurredAt}>{formatTranscriptTime(turn.occurredAt)}</time>
                            </div>
                            <p>{turn.transcript}</p>
                          </div>
                        ))
                      ) : (
                        <div className="calling-transcript__empty">
                          Waiting for the first final transcript line...
                        </div>
                      )}

                      {selectedExternalCall.partialTranscript ? (
                        <div className="calling-transcript__partial">
                          <span>
                            {selectedCallIsMrTester
                              ? selectedExternalCall.partialRole === "assistant"
                                ? "Mr Tester speaking"
                                : "OpsUI agent speaking"
                              : selectedExternalCall.partialRole === "assistant"
                                ? "OpsUI agent speaking"
                                : "Customer speaking"}
                          </span>
                          <p>{selectedExternalCall.partialTranscript}</p>
                        </div>
                      ) : null}
                    </div>

                    {selectedExternalCall.summary ? (
                      <div className="calling-transcript__summary">
                        <strong>Call summary</strong>
                        <p>{selectedExternalCall.summary}</p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="calling-empty">
                Vapi calls will appear here when Make forwards the first event.
              </div>
            )}
          </section>

          <div className="calling-call-list">
            {activeBatchCalls.length ? (
              activeBatchCalls.map((call) => {
                const prospect = prospectsById.get(call.prospectId);

                return (
                  <div className="calling-call" key={call.id}>
                    <div>
                      <strong>{prospect?.name ?? "Unknown prospect"}</strong>
                      <span>{prospect?.companyName ?? "Unknown company"}</span>
                    </div>
                    <span className={`calling-status calling-status--${call.status}`}>
                      {callStatusLabels[call.status]}
                    </span>
                    <span>{call.outcome ?? "No outcome yet"}</span>
                    <span>{formatDateTime(call.completedAt ?? call.startedAt)}</span>
                  </div>
                );
              })
            ) : (
              <div className="calling-empty">No batch calls yet.</div>
            )}
          </div>
        </div>
      ) : activeTab === "sheets" ? (
        <div className="calling-prospects">
          <form
            className="calling-form"
            onSubmit={(event) => void handleCreateSheetSource(event)}
          >
            <div className="calling-form__grid">
              <label>
                Sheet URL or ID
                <input
                  onChange={(event) =>
                    setSheetForm((current) => ({
                      ...current,
                      urlOrId: event.target.value,
                    }))
                  }
                  required
                  value={sheetForm.urlOrId}
                />
              </label>
              <label>
                Label
                <input
                  onChange={(event) =>
                    setSheetForm((current) => ({
                      ...current,
                      label: event.target.value,
                    }))
                  }
                  value={sheetForm.label}
                />
              </label>
            </div>
            <div className="calling-form__actions">
              <button
                className="header-action-button header-action-button--primary"
                disabled={isBusy || !sheetForm.urlOrId.trim()}
                type="submit"
              >
                {isBusy ? "Attaching..." : "Attach Sheet"}
              </button>
            </div>
          </form>

          <div className="calling-call-list">
            {sheetSources.length ? (
              sheetSources.map((source) => (
                <div className="calling-call" key={source.id}>
                  <div>
                    <strong>{source.label}</strong>
                    <span>{source.spreadsheetId}</span>
                  </div>
                  <span className="calling-status calling-status--new">Saved</span>
                  <span>{formatDateTime(source.createdAt)}</span>
                  <button
                    className="header-action-button"
                    disabled={isBusy}
                    onClick={() => void handleDeleteSheetSource(source)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))
            ) : (
              <div className="calling-empty">
                {workspace?.sheetConfigured
                  ? "Registered default sheet is active."
                  : "No sheets attached yet."}
              </div>
            )}
          </div>

        </div>
      ) : (
        <form className="calling-form" onSubmit={(event) => void handleCreateProspect(event)}>
          <div className="calling-form__grid">
            <label>
              Name
              <input
                autoComplete="name"
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                required
                value={form.name}
              />
            </label>
            <label>
              Phone number
              <input
                autoComplete="tel"
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                required
                type="tel"
                value={form.phone}
              />
            </label>
            <label>
              Company name
              <input
                autoComplete="organization"
                onChange={(event) =>
                  setForm((current) => ({ ...current, companyName: event.target.value }))
                }
                required
                value={form.companyName}
              />
            </label>
            <label>
              Email
              <input
                autoComplete="email"
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                type="email"
                value={form.email}
              />
            </label>
          </div>
          <label>
            Notes
            <textarea
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              rows={5}
              value={form.notes}
            />
          </label>
          <div className="calling-form__actions">
            <button
              className="header-action-button header-action-button--primary"
              disabled={
                isBusy ||
                !form.name.trim() ||
                !form.phone.trim() ||
                !form.companyName.trim()
              }
              type="submit"
            >
              {isBusy ? "Adding..." : "Add Prospect"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
};

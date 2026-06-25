import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CallingBatch,
  CallingCall,
  CallingProspect,
  CallingProspectStatus,
  CallingWorkspaceResponse,
} from "@opsui/shared";
import {
  ApiError,
  createCallingBatch,
  createCallingProspect,
  getCallingWorkspace,
  startNextCallingBatchCall,
  syncCallingProspects,
} from "../lib/api";

type Props = {
  authToken: string;
};

type CallingTab = "prospects" | "queue" | "add";
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
  const [selectedProspectIds, setSelectedProspectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProspectFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    companyName: "",
    email: "",
    notes: "",
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

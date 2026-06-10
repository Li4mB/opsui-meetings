import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import type {
  AiMeetingGuideBinding,
  AiMeetingGuide,
  AuthBootstrapUser,
  CreateMeetingRequestInput,
  CreateUserInput,
  LoftPackageKey,
  LoginInput,
  Meeting,
  MeetingRequest,
  Session,
  UpdateUserInput,
  User,
} from "@opsui/shared";
import {
  ApiError,
  assignMeeting,
  createMeetingRequest,
  createUser,
  deleteUser,
  generateMeetingGuide,
  getAuthBootstrap,
  getCurrentSessionUser,
  getSavedMeetingGuide,
  getLoftAccess,
  getLoftBookings,
  getMeetings,
  getPastMeetings,
  getUsers,
  login,
  unlockLoft,
  sendLoftPaymentLink,
  resolveMeeting,
  saveMeetingGuide,
  syncMeetings,
  updateUser,
} from "./lib/api";
import {
  clearSessionCache,
  loadMeetingsCache,
  loadCurrentMeetingCache,
  loadPastMeetingsCache,
  loadSessionCache,
  loadUsersCache,
  saveCurrentMeetingCache,
  saveMeetingsCache,
  savePastMeetingsCache,
  saveSessionCache,
  saveUsersCache,
} from "./lib/cache";
import {
  clearStoredSession,
  loadStoredSession,
  saveStoredSession,
} from "./lib/session";
import {
  closeEmbeddedCurrentMeetingView,
  closeCurrentMeetingWindow,
  isTauriApp,
  openExternalUrl,
} from "./lib/platform";
import { useAppStore } from "./store/app-store";
import { AppShell } from "./components/AppShell";
import { LoginScreen } from "./components/LoginScreen";
import { UpdateGate } from "./components/UpdateGate";
import { normalizeMeeting, normalizeMeetings } from "./lib/meeting-normalization";
import {
  checkForAppUpdate,
  installAppUpdate,
  type UpdateState,
} from "./lib/updater";
import { ensureNotificationPermission, notifyNewMeetings } from "./lib/notify";

type BootState = "loading" | "ready" | "error";
type UpdateCheckStatus =
  | { phase: "idle" | "checking" | "current" }
  | { phase: "error"; message: string };
const STARTUP_TIMEOUT_MS = 3000;
const UPDATE_POLL_INTERVAL_MS = 2 * 60 * 1000;
// Background auto-sync cadence for meeting data (mirrors the updater poll).
const MEETING_SYNC_INTERVAL_MS = 2 * 60 * 1000;

async function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => {
      window.setTimeout(() => resolve(fallback), STARTUP_TIMEOUT_MS);
    }),
  ]);
}

const App = () => {
  const updaterEnabled = !import.meta.env.DEV && isTauriApp();
  const session = useAppStore((state) => state.session);
  const meetings = useAppStore((state) => state.meetings);
  const pastMeetings = useAppStore((state) => state.pastMeetings);
  const currentMeeting = useAppStore((state) => state.currentMeeting);
  const users = useAppStore((state) => state.users);
  const loftBookings = useAppStore((state) => state.loftBookings);
  const loftHasAccess = useAppStore((state) => state.loftHasAccess);
  const lastSuccessfulSyncAt = useAppStore((state) => state.lastSuccessfulSyncAt);
  const selectedMeetingId = useAppStore((state) => state.selectedMeetingId);
  const viewMode = useAppStore((state) => state.viewMode);
  const surfaceMode = useAppStore((state) => state.surfaceMode);
  const filters = useAppStore((state) => state.filters);
  const syncStatus = useAppStore((state) => state.syncStatus);
  const syncMessage = useAppStore((state) => state.syncMessage);
  const offline = useAppStore((state) => state.offline);
  const setSession = useAppStore((state) => state.setSession);
  const setMeetings = useAppStore((state) => state.setMeetings);
  const setPastMeetings = useAppStore((state) => state.setPastMeetings);
  const setCurrentMeeting = useAppStore((state) => state.setCurrentMeeting);
  const setCurrentMeetingMode = useAppStore((state) => state.setCurrentMeetingMode);
  const setUsers = useAppStore((state) => state.setUsers);
  const setLoftBookings = useAppStore((state) => state.setLoftBookings);
  const setLoftHasAccess = useAppStore((state) => state.setLoftHasAccess);
  const updateMeetingInStore = useAppStore((state) => state.updateMeeting);
  const setSelectedMeetingId = useAppStore((state) => state.setSelectedMeetingId);
  const setViewMode = useAppStore((state) => state.setViewMode);
  const setSurfaceMode = useAppStore((state) => state.setSurfaceMode);
  const setFilters = useAppStore((state) => state.setFilters);
  const resetFilters = useAppStore((state) => state.resetFilters);
  const setSyncState = useAppStore((state) => state.setSyncState);
  const setOffline = useAppStore((state) => state.setOffline);
  const clearWorkspace = useAppStore((state) => state.clearWorkspace);

  const [bootState, setBootState] = useState<BootState>("loading");
  const [bootError, setBootError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [approvedUsers, setApprovedUsers] = useState<AuthBootstrapUser[]>([]);
  const [updateState, setUpdateState] = useState<UpdateState>(
    updaterEnabled ? { status: "checking" } : { status: "ready" },
  );
  // Non-blocking record of the last check so the header can show "up to date",
  // "checking", or a retryable failure instead of failing silently.
  const [updateCheckStatus, setUpdateCheckStatus] = useState<UpdateCheckStatus>(
    updaterEnabled ? { phase: "checking" } : { phase: "idle" },
  );
  const updateCheckInFlight = useRef(false);
  const deferredQuery = useDeferredValue(filters.query.trim().toLowerCase());

  // --- New-meeting detection for desktop notifications ---
  // googleEventIds (fallback: id) we've already accounted for. Notifications
  // stay disarmed until a baseline is established (cache + first sync) so we
  // never alert for the entire calendar on first load / login.
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const notificationsArmedRef = useRef(false);
  const meetingPollInFlight = useRef(false);
  const sessionRef = useRef<Session | null>(session);
  sessionRef.current = session;

  const detectNewMeetings = (incoming: Meeting[]): Meeting[] => {
    const seen = seenEventIdsRef.current;
    const fresh: Meeting[] = [];
    for (const meeting of incoming) {
      const key = meeting.googleEventId || meeting.id;
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (notificationsArmedRef.current) {
        fresh.push(meeting);
      }
    }
    return fresh;
  };

  const selectedMeeting =
    meetings.find((meeting) => meeting.id === selectedMeetingId) ??
    pastMeetings.find((meeting) => meeting.id === selectedMeetingId) ??
    null;

  const reconcileCurrentMeeting = (
    snapshot: Meeting | null,
    nextMeetings: Meeting[],
    nextPastMeetings: Meeting[],
  ) => {
    if (!snapshot) {
      return null;
    }

    const matchedMeeting =
      nextMeetings.find(
        (meeting) => meeting.googleEventId === snapshot.googleEventId,
      ) ??
      nextPastMeetings.find(
        (meeting) => meeting.googleEventId === snapshot.googleEventId,
      ) ??
      snapshot;

    return normalizeMeeting(matchedMeeting);
  };

  const matchesFilters = (meeting: Meeting) => {
    if (filters.country !== "All" && meeting.country !== filters.country) {
      return false;
    }

    if (filters.assignedUserId === "" && meeting.assignedUserId !== null) {
      return false;
    }

    if (
      filters.assignedUserId !== "all" &&
      filters.assignedUserId !== "" &&
      meeting.assignedUserId !== filters.assignedUserId
    ) {
      return false;
    }

    if (!deferredQuery) {
      return true;
    }

    const haystack = [
      meeting.clientName,
      meeting.company,
      meeting.clientEmail ?? "",
      meeting.meetingType,
      meeting.modulesOfInterest.join(" "),
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(deferredQuery);
  };

  const filteredMeetings = meetings.filter(matchesFilters);
  const filteredPastMeetings = pastMeetings.filter(matchesFilters);

  const applyWorkspace = async (
    incomingUsers: User[],
    incomingMeetings: {
      meetings: Meeting[];
      lastSuccessfulSyncAt: string | null;
    },
    incomingPastMeetings: {
      meetings: Meeting[];
      lastSuccessfulSyncAt: string | null;
    },
  ) => {
    const normalizedMeetings = normalizeMeetings(incomingMeetings.meetings);
    const normalizedPastMeetings = normalizeMeetings(incomingPastMeetings.meetings);
    const nextCurrentMeeting = reconcileCurrentMeeting(
      currentMeeting,
      normalizedMeetings,
      normalizedPastMeetings,
    );

    // Detect genuinely-new upcoming meetings (no-op until armed) and notify.
    const newMeetings = detectNewMeetings(normalizedMeetings);

    startTransition(() => {
      setUsers(incomingUsers);
      setMeetings(normalizedMeetings, incomingMeetings.lastSuccessfulSyncAt);
      setPastMeetings(normalizedPastMeetings);
      setCurrentMeeting(nextCurrentMeeting);
      setOffline(false);
      setSyncState("idle", null);
    });

    await Promise.all([
      saveUsersCache(incomingUsers),
      saveMeetingsCache({
        ...incomingMeetings,
        meetings: normalizedMeetings,
      }),
      savePastMeetingsCache({
        ...incomingPastMeetings,
        meetings: normalizedPastMeetings,
      }),
      saveCurrentMeetingCache(nextCurrentMeeting),
    ]);

    if (newMeetings.length > 0) {
      void notifyNewMeetings(newMeetings);
    }
  };

  const resetSession = async (message?: string) => {
    clearWorkspace();
    await Promise.all([clearSessionCache(), clearStoredSession()]);
    setLoginError(message ?? null);
  };

  // Keep Loft access + bookings fresh. Errors are swallowed so a Loft outage
  // never breaks the core meetings workspace refresh / bootstrap / auto-sync.
  const refreshLoft = async (token: string) => {
    try {
      const access = await getLoftAccess(token);
      setLoftHasAccess(access.hasAccess);

      if (access.hasAccess) {
        const data = await getLoftBookings(token);
        setLoftBookings(data.bookings);
      } else {
        setLoftBookings([]);
      }
    } catch {
      // Ignore Loft refresh failures; the meetings workspace stays usable.
    }
  };

  const refreshWorkspace = async (
    activeSession: Session,
    options: { syncFirst: boolean; quiet?: boolean },
  ) => {
    if (!options.quiet) {
      setSyncState(
        "syncing",
        options.syncFirst
          ? "Refreshing Google Calendar..."
          : "Loading workspace...",
      );
    }

    try {
      const currentSession = await getCurrentSessionUser(activeSession.token);
      const nextSession: Session = {
        token: activeSession.token,
        user: currentSession.user,
      };

      setSession(nextSession);
      await Promise.all([
        saveSessionCache(nextSession),
        saveStoredSession(nextSession),
      ]);

      if (options.syncFirst) {
        await syncMeetings(nextSession.token);
      }

      const [incomingUsers, incomingMeetings, incomingPastMeetings] = await Promise.all([
        getUsers(nextSession.token),
        getMeetings(nextSession.token),
        getPastMeetings(nextSession.token),
      ]);

      await applyWorkspace(incomingUsers, incomingMeetings, incomingPastMeetings);
      await refreshLoft(nextSession.token);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await resetSession("Your session expired. Please sign in again.");
        return;
      }

      setOffline(true);
      // Background (quiet) polls shouldn't flip the visible status to an error
      // on a transient blip; the offline flag already conveys connectivity.
      if (!options.quiet) {
        setSyncState(
          "error",
          error instanceof Error ? error.message : "Unable to reach OpsUI services",
        );
      }
    }
  };
  const refreshWorkspaceEvent = useEffectEvent(refreshWorkspace);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      try {
        const [
          cachedMeetings,
          cachedPastMeetings,
          cachedCurrentMeeting,
          cachedUsers,
          cachedSession,
          authBootstrap,
        ] =
          await Promise.all([
            withTimeout(loadMeetingsCache(), {
              meetings: [],
              lastSuccessfulSyncAt: null,
            }),
            withTimeout(loadPastMeetingsCache(), {
              meetings: [],
              lastSuccessfulSyncAt: null,
            }),
            withTimeout(loadCurrentMeetingCache(), null),
            withTimeout(loadUsersCache(), []),
            withTimeout(
              (async () => {
                const storedSession = await loadStoredSession();
                return storedSession ?? (await loadSessionCache());
              })(),
              null,
            ),
            withTimeout(getAuthBootstrap(), { users: [] }),
          ]);

        if (!active) {
          return;
        }

        const normalizedCachedMeetings = {
          ...cachedMeetings,
          meetings: normalizeMeetings(cachedMeetings.meetings),
        };
        const normalizedCachedPastMeetings = {
          ...cachedPastMeetings,
          meetings: normalizeMeetings(cachedPastMeetings.meetings),
        };
        const normalizedCachedCurrentMeeting = cachedCurrentMeeting
          ? normalizeMeeting(cachedCurrentMeeting)
          : null;

        // Seed the notification baseline from cached meetings so reopening the
        // app never re-alerts for meetings that were already known.
        for (const meeting of normalizedCachedMeetings.meetings) {
          const key = meeting.googleEventId || meeting.id;
          if (key) {
            seenEventIdsRef.current.add(key);
          }
        }

        let nextSession = cachedSession;

        if (cachedSession) {
          try {
            const currentSession = await withTimeout(
              getCurrentSessionUser(cachedSession.token),
              null,
            );

            if (currentSession) {
              nextSession = {
                token: cachedSession.token,
                user: currentSession.user,
              };

              await Promise.all([
                saveSessionCache(nextSession),
                saveStoredSession(nextSession),
              ]);
            }
          } catch (error) {
            if (error instanceof ApiError && error.status === 401) {
              nextSession = null;
              await Promise.all([clearSessionCache(), clearStoredSession()]);
              setLoginError("Your session expired. Please sign in again.");
            }
          }
        }

        startTransition(() => {
          setMeetings(
            normalizedCachedMeetings.meetings,
            normalizedCachedMeetings.lastSuccessfulSyncAt,
          );
          setPastMeetings(normalizedCachedPastMeetings.meetings);
          setCurrentMeeting(normalizedCachedCurrentMeeting);
          setUsers(cachedUsers);
          setSession(nextSession);
          setApprovedUsers(authBootstrap.users);
        });

        if (nextSession) {
          void Promise.all([
            saveSessionCache(nextSession),
            saveStoredSession(nextSession),
          ]);
        }

        setBootState("ready");

        if (nextSession) {
          // The initial refresh completes the baseline; arm notifications only
          // afterwards so the first network sync doesn't alert for everything.
          void refreshWorkspaceEvent(nextSession, {
            syncFirst: false,
            quiet: true,
          }).then(() => {
            notificationsArmedRef.current = true;
          });
        }
      } catch (error) {
        setBootError(
          error instanceof Error
            ? error.message
            : "Unable to start Opsui Admin Dashboard",
        );
        setBootState("error");
      }
    };

    void bootstrap();

    return () => {
      active = false;
    };
  }, [
    setMeetings,
    setCurrentMeeting,
    setPastMeetings,
    setOffline,
    setSession,
    setSyncState,
    setUsers,
  ]);

  const handleLogin = async (credentials: LoginInput) => {
    setLoggingIn(true);
    setLoginError(null);

    // Fresh login = fresh baseline; don't notify for the account's existing
    // meetings, only ones that arrive after this first sync.
    notificationsArmedRef.current = false;
    seenEventIdsRef.current = new Set();

    try {
      const nextSession = await login(credentials);
      setSession(nextSession);
      await Promise.all([
        saveSessionCache(nextSession),
        saveStoredSession(nextSession),
      ]);
      await refreshWorkspace(nextSession, { syncFirst: true });
      notificationsArmedRef.current = true;
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : "Unable to sign in",
      );
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await closeEmbeddedCurrentMeetingView();
    await closeCurrentMeetingWindow();
    clearWorkspace();
    await Promise.all([clearSessionCache(), clearStoredSession()]);
    setLoginError(null);
    // Reset notification baseline so a different account starts clean.
    notificationsArmedRef.current = false;
    seenEventIdsRef.current = new Set();
  };

  const handleAssign = async (meetingId: string, assignedUserId: string | null) => {
    if (!session) {
      return;
    }

    try {
      setSyncState("syncing", "Saving assignment...");
      const updatedMeeting = normalizeMeeting(await assignMeeting(
        session.token,
        meetingId,
        assignedUserId,
      ));
      const nextMeetings = meetings.map((meeting) =>
        meeting.id === updatedMeeting.id ? updatedMeeting : meeting,
      );

      updateMeetingInStore(updatedMeeting);
      await saveMeetingsCache({
        meetings: nextMeetings,
        lastSuccessfulSyncAt,
      });
      setSyncState("idle", "Assignment saved");
    } catch (error) {
      setSyncState(
        "error",
        error instanceof Error ? error.message : "Unable to save assignment",
      );
    }
  };

  const handleCreateUser = async (input: CreateUserInput) => {
    if (!session) {
      return;
    }

    setSyncState("syncing", "Creating user...");

    try {
      await createUser(session.token, input);
      await refreshWorkspace(session, { syncFirst: false, quiet: true });
      setSyncState("idle", "User added");
    } catch (error) {
      setSyncState(
        "error",
        error instanceof Error ? error.message : "Unable to create user",
      );
    }
  };

  const handleUpdateUser = async (userId: string, input: UpdateUserInput) => {
    if (!session) {
      return;
    }

    setSyncState("syncing", "Updating user...");

    try {
      await updateUser(session.token, userId, input);
      await refreshWorkspace(session, { syncFirst: false, quiet: true });
      setSyncState("idle", "User updated");
    } catch (error) {
      setSyncState(
        "error",
        error instanceof Error ? error.message : "Unable to update user",
      );
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!session) {
      return;
    }

    setSyncState("syncing", "Removing user...");

    try {
      await deleteUser(session.token, userId);
      await refreshWorkspace(session, { syncFirst: false, quiet: true });
      setSyncState("idle", "User removed");
    } catch (error) {
      setSyncState(
        "error",
        error instanceof Error ? error.message : "Unable to remove user",
      );
    }
  };

  const handleCreateMeetingRequest = async (
    input: CreateMeetingRequestInput,
  ): Promise<MeetingRequest> => {
    if (!session) {
      throw new Error("No active session");
    }

    setSyncState("syncing", "Saving meeting intake...");

    try {
      const created = await createMeetingRequest(session.token, input);
      setSyncState("idle", "Meeting intake saved");
      return created;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to save the meeting intake";
      setSyncState("error", message);
      throw new Error(message);
    }
  };

  const handleUnlockLoft = async (password: string) => {
    if (!session) {
      setSyncState("error", "Sign in before unlocking Loft");
      return;
    }

    try {
      const result = await unlockLoft(session.token, password);

      if (result.hasAccess) {
        setLoftHasAccess(true);
        const data = await getLoftBookings(session.token);
        setLoftBookings(data.bookings);
        setSurfaceMode("loft");
      }
    } catch {
      setSyncState("error", "Incorrect Loft password");
    }
  };

  const handleSendLoftPaymentLink = async (
    bookingId: string,
    packageKey: LoftPackageKey,
  ) => {
    if (!session) {
      throw new Error("No active session");
    }

    // Throws on failure so LoftList can surface the error on the card.
    const result = await sendLoftPaymentLink(session.token, bookingId, packageKey);
    setSyncState("idle", `Payment link emailed to ${result.emailedTo}`);
  };

  const handleResolveMeeting = async (meetingId: string) => {
    if (!session) {
      return;
    }

    setSyncState("syncing", "Resolving meeting...");

    try {
      await resolveMeeting(session.token, meetingId);
      setSelectedMeetingId(null);
      await refreshWorkspace(session, { syncFirst: false, quiet: true });
      setSyncState("idle", "Meeting moved to past meetings");
    } catch (error) {
      setSyncState(
        "error",
        error instanceof Error ? error.message : "Unable to resolve meeting",
      );
    }
  };

  const handleStartCurrentMeeting = async (meeting: Meeting) => {
    if (!meeting.googleMeetUrl) {
      return;
    }

    const normalizedMeeting = normalizeMeeting(meeting);
    await closeCurrentMeetingWindow();
    setCurrentMeeting(normalizedMeeting);
    setCurrentMeetingMode("embedded");
    setSurfaceMode("current");
    await saveCurrentMeetingCache(normalizedMeeting);
    await openExternalUrl(normalizedMeeting.googleMeetUrl!);
  };

  const handleClearCurrentMeeting = async () => {
    setCurrentMeeting(null);
    setCurrentMeetingMode("embedded");
    if (surfaceMode === "current") {
      setSurfaceMode("meetings");
    }
    await closeEmbeddedCurrentMeetingView();
    await saveCurrentMeetingCache(null);
    await closeCurrentMeetingWindow();
  };

  const handleGenerateMeetingGuide = async (
    meetingId: string,
  ): Promise<AiMeetingGuide> => {
    if (!session) {
      throw new Error("No active session");
    }

    return generateMeetingGuide(session.token, meetingId);
  };

  const handleLoadSavedMeetingGuide = async (
    meetingId: string,
  ): Promise<AiMeetingGuideBinding> => {
    if (!session) {
      throw new Error("No active session");
    }

    return getSavedMeetingGuide(session.token, meetingId);
  };

  const handleSaveMeetingGuide = async (
    meetingId: string,
    guide: AiMeetingGuide,
  ): Promise<AiMeetingGuideBinding> => {
    if (!session) {
      throw new Error("No active session");
    }

    return saveMeetingGuide(session.token, meetingId, guide);
  };

  const handleInstallUpdate = async (
    updateOverride?: Extract<UpdateState, { update: unknown }>["update"],
  ) => {
    const update =
      updateOverride ??
      (updateState.status === "required" ||
      updateState.status === "installing" ||
      updateState.status === "error"
        ? updateState.update
        : null);

    if (!update) {
      return;
    }

    setUpdateState({
      status: "installing",
      update,
      progress: 0,
      message: "Downloading update...",
    });

    try {
      await installAppUpdate(update, (progress) => {
        setUpdateState((current) =>
          current.status === "installing"
            ? {
                ...current,
                progress,
                message:
                  progress >= 1 ? "Installing update..." : "Downloading update...",
              }
            : current,
        );
      });
    } catch (error) {
      setUpdateState({
        status: "error",
        update,
        progress: 0,
        message:
          error instanceof Error
            ? error.message
            : "Unable to install the latest approved release automatically.",
      });
    }
  };
  const runUpdateCheck = async (showCheckingScreen = false) => {
    if (!updaterEnabled) {
      setUpdateState({ status: "ready" });
      return;
    }

    // Never interrupt an update that is already downloading/installing or a
    // surfaced install error the user is acting on.
    if (
      updateState.status === "required" ||
      updateState.status === "installing" ||
      updateState.status === "error"
    ) {
      return;
    }

    if (updateCheckInFlight.current) {
      return;
    }

    updateCheckInFlight.current = true;

    if (showCheckingScreen && updateState.status !== "ready") {
      setUpdateState({ status: "checking" });
    }
    setUpdateCheckStatus({ phase: "checking" });

    const result = await checkForAppUpdate();
    updateCheckInFlight.current = false;

    if (result.kind === "update") {
      setUpdateCheckStatus({ phase: "current" });
      setUpdateState({
        status: "required",
        update: result.update,
        progress: 0,
        message: "Update found. Installing automatically...",
      });
      void handleInstallUpdate(result.update);
      return;
    }

    if (result.kind === "error") {
      // A failed check must not lock the user out — proceed into the app, but
      // surface the failure so it can be retried instead of looking "up to date".
      setUpdateCheckStatus({ phase: "error", message: result.message });
      setUpdateState((current) =>
        current.status === "checking" ? { status: "ready" } : current,
      );
      return;
    }

    // "current" (confirmed latest) or "unsupported" (web build): unblock the app.
    setUpdateCheckStatus({ phase: "current" });
    setUpdateState((current) =>
      current.status === "checking" ? { status: "ready" } : current,
    );
  };
  // Keep the timer/focus/online handlers pointed at the latest closure (fresh
  // updateState) without resubscribing the listeners on every state change.
  const runUpdateCheckRef = useRef(runUpdateCheck);
  useEffect(() => {
    runUpdateCheckRef.current = runUpdateCheck;
  });

  useEffect(() => {
    if (!updaterEnabled) {
      setUpdateState({ status: "ready" });
      return;
    }

    void runUpdateCheckRef.current(true);

    const updateInterval = window.setInterval(() => {
      void runUpdateCheckRef.current(false);
    }, UPDATE_POLL_INTERVAL_MS);

    const handleWindowFocus = () => {
      void runUpdateCheckRef.current(false);
    };
    const handleOnline = () => {
      // Network regained — retry immediately rather than waiting for the poll.
      void runUpdateCheckRef.current(false);
    };

    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("online", handleOnline);

    return () => {
      window.clearInterval(updateInterval);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("online", handleOnline);
    };
  }, [updaterEnabled]);

  // Ask for OS notification permission once the user is authenticated.
  useEffect(() => {
    if (session) {
      void ensureNotificationPermission();
    }
  }, [session?.token]);

  // Background auto-sync: keep meeting data fresh without the manual button.
  // Runs on an interval, on window focus, and when connectivity returns. Keeps
  // running while the window is hidden-to-tray, which is what drives new-meeting
  // notifications when the app isn't in the foreground.
  useEffect(() => {
    if (!session?.token) {
      return;
    }

    let active = true;

    const runAutoSync = async () => {
      if (meetingPollInFlight.current || !active) {
        return;
      }
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return;
      }
      const activeSession = sessionRef.current;
      if (!activeSession) {
        return;
      }

      meetingPollInFlight.current = true;
      try {
        await refreshWorkspaceEvent(activeSession, {
          syncFirst: true,
          quiet: true,
        });
      } finally {
        meetingPollInFlight.current = false;
      }
    };

    const interval = window.setInterval(() => {
      void runAutoSync();
    }, MEETING_SYNC_INTERVAL_MS);

    const handleFocus = () => void runAutoSync();
    const handleOnline = () => void runAutoSync();
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
    };
  }, [session?.token]);

  if (updateState.status !== "ready") {
    return (
      <UpdateGate
        onInstall={() => handleInstallUpdate()}
        updateState={updateState}
      />
    );
  }

  if (bootState === "loading") {
    return (
      <div className="splash-screen">
        <div className="eyebrow">Opsui Admin Dashboard</div>
        <h1>Loading workspace</h1>
        <p>Preparing cached workspace data, session state, and release policy.</p>
      </div>
    );
  }

  if (bootState === "error") {
    return (
      <div className="splash-screen">
        <div className="eyebrow">Startup issue</div>
        <h1>Opsui Admin Dashboard could not start</h1>
        <p>{bootError}</p>
      </div>
    );
  }

  if (!session) {
    return (
      <LoginScreen
        approvedUsers={approvedUsers}
        error={loginError}
        isLoading={loggingIn}
        onSubmit={handleLogin}
      />
    );
  }

  return (
    <AppShell
      filteredMeetings={filteredMeetings}
      filteredPastMeetings={filteredPastMeetings}
      filters={filters}
      currentMeeting={currentMeeting}
      lastSuccessfulSyncAt={lastSuccessfulSyncAt}
      loftBookings={loftBookings}
      loftHasAccess={loftHasAccess}
      meetings={meetings}
      pastMeetings={pastMeetings}
      offline={offline}
      onAssign={handleAssign}
      onCloseMeeting={() => setSelectedMeetingId(null)}
      onCreateUser={handleCreateUser}
      onDeleteUser={handleDeleteUser}
      onLogout={handleLogout}
      onCreateMeetingRequest={handleCreateMeetingRequest}
      onOpenUrl={openExternalUrl}
      onClearCurrentMeeting={handleClearCurrentMeeting}
      onGenerateMeetingGuide={handleGenerateMeetingGuide}
      onLoadSavedMeetingGuide={handleLoadSavedMeetingGuide}
      onSaveMeetingGuide={handleSaveMeetingGuide}
      onResolveMeeting={handleResolveMeeting}
      onResetFilters={resetFilters}
      onSelectMeeting={setSelectedMeetingId}
      onSetFilters={setFilters}
      onSetSurfaceMode={setSurfaceMode}
      onStartCurrentMeeting={handleStartCurrentMeeting}
      onSetViewMode={setViewMode}
      onSync={() => refreshWorkspace(session, { syncFirst: true })}
      onCheckForUpdates={() => void runUpdateCheck(true)}
      updaterSupported={updaterEnabled}
      updateCheckPhase={updateCheckStatus.phase}
      updateCheckError={
        updateCheckStatus.phase === "error" ? updateCheckStatus.message : null
      }
      onUnlockLoft={handleUnlockLoft}
      onSendLoftPaymentLink={handleSendLoftPaymentLink}
      onUpdateUser={handleUpdateUser}
      selectedMeeting={selectedMeeting}
      session={session}
      surfaceMode={surfaceMode}
      syncMessage={syncMessage}
      syncStatus={syncStatus}
      users={users}
      viewMode={viewMode}
    />
  );
};

export default App;

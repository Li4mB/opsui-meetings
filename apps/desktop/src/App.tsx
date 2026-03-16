import { startTransition, useDeferredValue, useEffect, useState } from "react";
import type {
  AiMeetingGuideBinding,
  AiMeetingGuide,
  CreateMeetingRequestInput,
  CreateUserInput,
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
  getCurrentSessionUser,
  getSavedMeetingGuide,
  getMeetings,
  getPastMeetings,
  getUsers,
  login,
  resolveMeeting,
  saveMeetingGuide,
  syncMeetings,
  unlockMeetingGuide,
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
  closeEmbeddedCurrentMeetingView,
  closeCurrentMeetingWindow,
  openExternalUrl,
} from "./lib/platform";
import { useAppStore } from "./store/app-store";
import { AppShell } from "./components/AppShell";
import { LoginScreen } from "./components/LoginScreen";

type BootState = "loading" | "ready" | "error";
const STARTUP_TIMEOUT_MS = 3000;

async function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => {
      window.setTimeout(() => resolve(fallback), STARTUP_TIMEOUT_MS);
    }),
  ]);
}

const App = () => {
  const session = useAppStore((state) => state.session);
  const meetings = useAppStore((state) => state.meetings);
  const pastMeetings = useAppStore((state) => state.pastMeetings);
  const currentMeeting = useAppStore((state) => state.currentMeeting);
  const users = useAppStore((state) => state.users);
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
  const deferredQuery = useDeferredValue(filters.query.trim().toLowerCase());

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

    return (
      nextMeetings.find(
        (meeting) => meeting.googleEventId === snapshot.googleEventId,
      ) ??
      nextPastMeetings.find(
        (meeting) => meeting.googleEventId === snapshot.googleEventId,
      ) ??
      snapshot
    );
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
    const nextCurrentMeeting = reconcileCurrentMeeting(
      currentMeeting,
      incomingMeetings.meetings,
      incomingPastMeetings.meetings,
    );

    startTransition(() => {
      setUsers(incomingUsers);
      setMeetings(incomingMeetings.meetings, incomingMeetings.lastSuccessfulSyncAt);
      setPastMeetings(incomingPastMeetings.meetings);
      setCurrentMeeting(nextCurrentMeeting);
      setOffline(false);
      setSyncState("idle", null);
    });

    await Promise.all([
      saveUsersCache(incomingUsers),
      saveMeetingsCache(incomingMeetings),
      savePastMeetingsCache(incomingPastMeetings),
      saveCurrentMeetingCache(nextCurrentMeeting),
    ]);
  };

  const resetSession = async (message?: string) => {
    clearWorkspace();
    await clearSessionCache();
    setLoginError(message ?? null);
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
      await saveSessionCache(nextSession);

      if (options.syncFirst) {
        await syncMeetings(nextSession.token);
      }

      const [incomingUsers, incomingMeetings, incomingPastMeetings] = await Promise.all([
        getUsers(nextSession.token),
        getMeetings(nextSession.token),
        getPastMeetings(nextSession.token),
      ]);

      await applyWorkspace(incomingUsers, incomingMeetings, incomingPastMeetings);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await resetSession("Your session expired. Please sign in again.");
        return;
      }

      setOffline(true);
      setSyncState(
        "error",
        error instanceof Error ? error.message : "Unable to reach OpsUI services",
      );
    }
  };

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
            withTimeout(loadSessionCache(), null),
          ]);

        if (!active) {
          return;
        }

        startTransition(() => {
          setMeetings(cachedMeetings.meetings, cachedMeetings.lastSuccessfulSyncAt);
          setPastMeetings(cachedPastMeetings.meetings);
          setCurrentMeeting(cachedCurrentMeeting);
          setUsers(cachedUsers);
          setSession(cachedSession);
        });

        setBootState("ready");

        if (cachedSession) {
          void refreshWorkspace(cachedSession, { syncFirst: false, quiet: true });
        }
      } catch (error) {
        setBootError(
          error instanceof Error
            ? error.message
            : "Unable to start OpsUI Meetings",
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

    try {
      const nextSession = await login(credentials);
      setSession(nextSession);
      await saveSessionCache(nextSession);
      await refreshWorkspace(nextSession, { syncFirst: true });
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
    await clearSessionCache();
    setLoginError(null);
  };

  const handleAssign = async (meetingId: string, assignedUserId: string | null) => {
    if (!session) {
      return;
    }

    try {
      setSyncState("syncing", "Saving assignment...");
      const updatedMeeting = await assignMeeting(
        session.token,
        meetingId,
        assignedUserId,
      );
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

    await closeCurrentMeetingWindow();
    setCurrentMeeting(meeting);
    setCurrentMeetingMode("embedded");
    setSurfaceMode("current");
    await saveCurrentMeetingCache(meeting);
    await openExternalUrl(meeting.googleMeetUrl);
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

  const handleUnlockMeetingGuide = async (
    meetingId: string,
  ): Promise<AiMeetingGuideBinding> => {
    if (!session) {
      throw new Error("No active session");
    }

    return unlockMeetingGuide(session.token, meetingId);
  };

  // Local build fallback: bypass the blocking updater gate while we validate the rest of the app.

  if (bootState === "loading") {
    return (
      <div className="splash-screen">
        <div className="eyebrow">OpsUI Meetings</div>
        <h1>Loading workspace</h1>
        <p>Preparing cached meetings, session state, and release policy.</p>
      </div>
    );
  }

  if (bootState === "error") {
    return (
      <div className="splash-screen">
        <div className="eyebrow">Startup issue</div>
        <h1>OpsUI Meetings could not start</h1>
        <p>{bootError}</p>
      </div>
    );
  }

  if (!session) {
    return (
      <LoginScreen
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
      onUnlockMeetingGuide={handleUnlockMeetingGuide}
      onResolveMeeting={handleResolveMeeting}
      onResetFilters={resetFilters}
      onSelectMeeting={setSelectedMeetingId}
      onSetFilters={setFilters}
      onSetSurfaceMode={setSurfaceMode}
      onStartCurrentMeeting={handleStartCurrentMeeting}
      onSetViewMode={setViewMode}
      onSync={() => refreshWorkspace(session, { syncFirst: true })}
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

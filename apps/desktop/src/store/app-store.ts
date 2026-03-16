import type { Country, Meeting, Session, User } from "@opsui/shared";
import { create } from "zustand";

export type ViewMode = "list" | "calendar";
export type SurfaceMode = "meetings" | "past" | "current" | "create" | "admin";
export type CurrentMeetingMode = "embedded" | "window";
export type CountryFilter = "All" | Country;

export type MeetingFilters = {
  country: CountryFilter;
  assignedUserId: string;
  query: string;
};

type SyncStatus = "idle" | "syncing" | "error";

type AppState = {
  session: Session | null;
  meetings: Meeting[];
  pastMeetings: Meeting[];
  currentMeeting: Meeting | null;
  currentMeetingMode: CurrentMeetingMode;
  users: User[];
  lastSuccessfulSyncAt: string | null;
  selectedMeetingId: string | null;
  viewMode: ViewMode;
  surfaceMode: SurfaceMode;
  filters: MeetingFilters;
  syncStatus: SyncStatus;
  syncMessage: string | null;
  offline: boolean;
  setSession: (session: Session | null) => void;
  setMeetings: (meetings: Meeting[], lastSuccessfulSyncAt: string | null) => void;
  setPastMeetings: (meetings: Meeting[]) => void;
  setCurrentMeeting: (meeting: Meeting | null) => void;
  setCurrentMeetingMode: (mode: CurrentMeetingMode) => void;
  setUsers: (users: User[]) => void;
  updateMeeting: (meeting: Meeting) => void;
  setSelectedMeetingId: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setSurfaceMode: (mode: SurfaceMode) => void;
  setFilters: (filters: Partial<MeetingFilters>) => void;
  resetFilters: () => void;
  setSyncState: (status: SyncStatus, message?: string | null) => void;
  setOffline: (offline: boolean) => void;
  clearWorkspace: () => void;
};

const defaultFilters: MeetingFilters = {
  country: "All",
  assignedUserId: "all",
  query: "",
};

export const useAppStore = create<AppState>((set) => ({
  session: null,
  meetings: [],
  pastMeetings: [],
  currentMeeting: null,
  currentMeetingMode: "embedded",
  users: [],
  lastSuccessfulSyncAt: null,
  selectedMeetingId: null,
  viewMode: "list",
  surfaceMode: "meetings",
  filters: defaultFilters,
  syncStatus: "idle",
  syncMessage: null,
  offline: false,
  setSession: (session) => set({ session }),
  setMeetings: (meetings, lastSuccessfulSyncAt) =>
    set({ meetings, lastSuccessfulSyncAt }),
  setPastMeetings: (pastMeetings) => set({ pastMeetings }),
  setCurrentMeeting: (currentMeeting) => set({ currentMeeting }),
  setCurrentMeetingMode: (currentMeetingMode) => set({ currentMeetingMode }),
  setUsers: (users) => set({ users }),
  updateMeeting: (meeting) =>
    set((state) => ({
      meetings: state.meetings.map((entry) =>
        entry.id === meeting.id ? meeting : entry,
      ),
    })),
  setSelectedMeetingId: (selectedMeetingId) => set({ selectedMeetingId }),
  setViewMode: (viewMode) => set({ viewMode }),
  setSurfaceMode: (surfaceMode) => set({ surfaceMode }),
  setFilters: (filters) =>
    set((state) => ({ filters: { ...state.filters, ...filters } })),
  resetFilters: () => set({ filters: defaultFilters }),
  setSyncState: (syncStatus, syncMessage = null) => set({ syncStatus, syncMessage }),
  setOffline: (offline) => set({ offline }),
  clearWorkspace: () =>
    set({
      session: null,
      meetings: [],
      pastMeetings: [],
      currentMeeting: null,
      currentMeetingMode: "embedded",
      users: [],
      lastSuccessfulSyncAt: null,
      selectedMeetingId: null,
      filters: defaultFilters,
      syncStatus: "idle",
      syncMessage: null,
      offline: false,
      surfaceMode: "meetings",
      viewMode: "list",
    }),
}));

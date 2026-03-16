import type {
  AiMeetingGuide,
  AiMeetingGuideBinding,
  CreateMeetingRequestInput,
  CreateUserInput,
  Meeting,
  MeetingRequest,
  Session,
  UpdateUserInput,
  User,
} from "@opsui/shared";
import { formatSyncTimestamp } from "../lib/date";
import { viewerTimeZone } from "../lib/platform";
import { getCountryFlag, getInitials } from "../lib/ui";
import type {
  CountryFilter,
  SurfaceMode,
  ViewMode,
} from "../store/app-store";
import opsLogo from "../assets/op.png";
import { AdminPanel } from "./AdminPanel";
import { CreateMeetingPanel } from "./CreateMeetingPanel";
import { CurrentMeetingPanel } from "./CurrentMeetingPanel";
import { MeetingCalendar } from "./MeetingCalendar";
import { MeetingDetailDrawer } from "./MeetingDetailDrawer";
import { MeetingList } from "./MeetingList";

type Props = {
  session: Session;
  meetings: Meeting[];
  filteredMeetings: Meeting[];
  pastMeetings: Meeting[];
  filteredPastMeetings: Meeting[];
  currentMeeting: Meeting | null;
  users: User[];
  selectedMeeting: Meeting | null;
  viewMode: ViewMode;
  surfaceMode: SurfaceMode;
  filters: {
    country: CountryFilter;
    assignedUserId: string;
    query: string;
  };
  syncStatus: "idle" | "syncing" | "error";
  syncMessage: string | null;
  lastSuccessfulSyncAt: string | null;
  offline: boolean;
  onSetViewMode: (viewMode: ViewMode) => void;
  onSetSurfaceMode: (surfaceMode: SurfaceMode) => void;
  onSetFilters: (filters: Partial<{ country: CountryFilter; assignedUserId: string; query: string }>) => void;
  onResetFilters: () => void;
  onSelectMeeting: (meetingId: string) => void;
  onCloseMeeting: () => void;
  onSync: () => Promise<void>;
  onLogout: () => Promise<void>;
  onAssign: (meetingId: string, assignedUserId: string | null) => Promise<void>;
  onResolveMeeting: (meetingId: string) => Promise<void>;
  onStartCurrentMeeting: (meeting: Meeting) => Promise<void>;
  onClearCurrentMeeting: () => Promise<void>;
  onGenerateMeetingGuide: (meetingId: string) => Promise<AiMeetingGuide>;
  onLoadSavedMeetingGuide: (meetingId: string) => Promise<AiMeetingGuideBinding>;
  onSaveMeetingGuide: (
    meetingId: string,
    guide: AiMeetingGuide,
  ) => Promise<AiMeetingGuideBinding>;
  onUnlockMeetingGuide: (meetingId: string) => Promise<AiMeetingGuideBinding>;
  onOpenUrl: (url: string) => Promise<void>;
  onCreateUser: (input: CreateUserInput) => Promise<void>;
  onUpdateUser: (userId: string, input: UpdateUserInput) => Promise<void>;
  onDeleteUser: (userId: string) => Promise<void>;
  onCreateMeetingRequest: (
    input: CreateMeetingRequestInput,
  ) => Promise<MeetingRequest>;
};

const allCountryOptions: Array<{
  value: CountryFilter;
  label: string;
  flag: string;
}> = [
  { value: "All", label: "All", flag: "GL" },
  { value: "Australia", label: "Australia", flag: getCountryFlag("Australia") },
  { value: "NZ", label: "New Zealand", flag: getCountryFlag("NZ") },
  { value: "Unknown", label: "Unknown", flag: getCountryFlag("Unknown") },
];

const countMeetingsForUser = (meetings: Meeting[], userId: string) =>
  meetings.filter((meeting) => meeting.assignedUserId === userId).length;

export const AppShell = ({
  session,
  meetings,
  filteredMeetings,
  pastMeetings,
  filteredPastMeetings,
  currentMeeting,
  users,
  selectedMeeting,
  viewMode,
  surfaceMode,
  filters,
  syncStatus,
  syncMessage,
  lastSuccessfulSyncAt,
  offline,
  onSetViewMode,
  onSetSurfaceMode,
  onSetFilters,
  onResetFilters,
  onSelectMeeting,
  onCloseMeeting,
  onSync,
  onLogout,
  onAssign,
  onResolveMeeting,
  onStartCurrentMeeting,
  onClearCurrentMeeting,
  onGenerateMeetingGuide,
  onLoadSavedMeetingGuide,
  onSaveMeetingGuide,
  onUnlockMeetingGuide,
  onOpenUrl,
  onCreateUser,
  onUpdateUser,
  onDeleteUser,
  onCreateMeetingRequest,
}: Props) => {
  const canAccessAdmin = session.user.role === "admin";
  const activeSurfaceMode =
    !canAccessAdmin && surfaceMode === "admin" ? "meetings" : surfaceMode;
  const scopedMeetings = activeSurfaceMode === "past" ? pastMeetings : meetings;
  const scopedFilteredMeetings =
    activeSurfaceMode === "past" ? filteredPastMeetings : filteredMeetings;
  const activeUsers = users.filter((user) => user.active);
  const assignedCount = scopedMeetings.filter((meeting) => meeting.assignedUserId).length;
  const unassignedCount = scopedMeetings.length - assignedCount;
  const briefedCount = scopedMeetings.filter((meeting) => meeting.googleDocUrl).length;
  const selectedAssigneeCount =
    filters.assignedUserId === "all"
      ? scopedMeetings.length
      : filters.assignedUserId === ""
        ? unassignedCount
        : countMeetingsForUser(scopedMeetings, filters.assignedUserId);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__left">
          <div className="app-logo">
            <span className="app-logo__mark">
              <img alt="OpsUI logo" className="app-logo__image" src={opsLogo} />
            </span>
            <span className="app-logo__text">
              OpsUI <span className="app-logo__sub">Meetings</span>
            </span>
          </div>

          <div className="app-header__divider" />

          <nav className="app-nav">
            <button
              className={`app-nav__item ${activeSurfaceMode === "meetings" ? "app-nav__item--active" : ""}`}
              onClick={() => onSetSurfaceMode("meetings")}
              type="button"
            >
              Meetings
            </button>
            <button
              className={`app-nav__item ${activeSurfaceMode === "past" ? "app-nav__item--active" : ""}`}
              onClick={() => onSetSurfaceMode("past")}
              type="button"
            >
              Past Meetings
            </button>
            <button
              className={`app-nav__item ${activeSurfaceMode === "create" ? "app-nav__item--active" : ""}`}
              onClick={() => onSetSurfaceMode("create")}
              type="button"
            >
              Create Meeting
            </button>
            {currentMeeting ? (
              <button
                className={`app-nav__item ${activeSurfaceMode === "current" ? "app-nav__item--active" : ""}`}
                onClick={() => onSetSurfaceMode("current")}
                type="button"
              >
                Current Meeting
              </button>
            ) : null}
            {canAccessAdmin ? (
              <button
                className={`app-nav__item ${activeSurfaceMode === "admin" ? "app-nav__item--active" : ""}`}
                onClick={() => onSetSurfaceMode("admin")}
                type="button"
              >
                Admin
              </button>
            ) : null}
          </nav>
        </div>

        <div className="app-header__right">
          {activeSurfaceMode === "meetings" || activeSurfaceMode === "past" ? (
            <div className="header-search">
              <span className="header-search__icon">/</span>
              <input
                className="header-search__input"
                onChange={(event) => onSetFilters({ query: event.target.value })}
                placeholder="Search meetings, clients, email..."
                value={filters.query}
              />
            </div>
          ) : null}

          <div className="meta-pill">TZ {viewerTimeZone}</div>
          <div className={`meta-pill ${offline ? "meta-pill--alert" : ""}`}>
            {offline ? "Offline cache" : "Live API"}
          </div>

          <button
            className="header-action-button header-action-button--primary"
            onClick={() => void onSync()}
            type="button"
          >
            {syncStatus === "syncing" ? "Syncing..." : "Sync"}
          </button>
          <button
            className="header-action-button"
            onClick={() => void onLogout()}
            type="button"
          >
            Sign out
          </button>

          <div className="header-user">
            <div
              className="avatar"
              style={{
                width: 34,
                height: 34,
                background: session.user.colorHex,
                fontSize: 13,
              }}
            >
              {getInitials(session.user.displayName)}
            </div>
            <div className="header-user__info">
              <span className="header-user__name">{session.user.displayName}</span>
              <span className="header-user__role">{session.user.role}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <section className="sidebar-panel">
            <div className="sidebar-section__label">Signed in</div>
            <div className="sidebar-profile">
              <div
                className="avatar"
                style={{
                  width: 42,
                  height: 42,
                  background: session.user.colorHex,
                  fontSize: 15,
                }}
              >
                {getInitials(session.user.displayName)}
              </div>
              <div>
                <div className="sidebar-profile__name">{session.user.displayName}</div>
                <div className="sidebar-profile__meta">{session.user.username}</div>
                <div className="sidebar-profile__meta">Role: {session.user.role}</div>
              </div>
            </div>
          </section>

          {activeSurfaceMode === "create" ? (
            <>
              <section className="sidebar-panel">
                <div className="sidebar-section__label">Create flow</div>
                <div className="sidebar-panel__title">New demo intake</div>
                <div className="sidebar-meta">
                  Capture the prospect details, preferred meeting setup, and module
                  interest before the booking is finalised.
                </div>
              </section>

              <section className="sidebar-panel">
                <div className="sidebar-section__label">Quick guidance</div>
                <div className="sidebar-meta">
                  <div>Use the client’s direct contact details.</div>
                  <div>Select every module they mention.</div>
                  <div>Save the request once the preferred date and time are confirmed.</div>
                  {syncMessage ? <div>{syncMessage}</div> : null}
                </div>
              </section>
            </>
          ) : (
            <>
              <section className="sidebar-panel">
                <div className="sidebar-section__label">Filter by Country</div>
                {allCountryOptions.map((option) => {
                  const count =
                    option.value === "All"
                      ? scopedMeetings.length
                      : scopedMeetings.filter((meeting) => meeting.country === option.value).length;

                  return (
                    <button
                      key={option.value}
                      className={`sidebar-filter ${filters.country === option.value ? "sidebar-filter--active" : ""}`}
                      onClick={() => onSetFilters({ country: option.value })}
                      type="button"
                    >
                      <span className="sidebar-filter__flag">{option.flag}</span>
                      <span>{option.label}</span>
                      <span className="sidebar-filter__count">{count}</span>
                    </button>
                  );
                })}
              </section>

              <section className="sidebar-panel">
                <div className="sidebar-section__label">Filter by Team</div>
                <button
                  className={`sidebar-filter ${filters.assignedUserId === "all" ? "sidebar-filter--active" : ""}`}
                  onClick={() => onSetFilters({ assignedUserId: "all" })}
                  type="button"
                >
                  <span className="sidebar-filter__flag">TM</span>
                  <span>All members</span>
                  <span className="sidebar-filter__count">{scopedMeetings.length}</span>
                </button>

                <button
                  className={`sidebar-filter ${filters.assignedUserId === "" ? "sidebar-filter--active" : ""}`}
                  onClick={() => onSetFilters({ assignedUserId: "" })}
                  type="button"
                >
                  <span className="sidebar-filter__flag">--</span>
                  <span>Unassigned</span>
                  <span className="sidebar-filter__count">{unassignedCount}</span>
                </button>

                {activeUsers.map((user) => (
                  <button
                    key={user.id}
                    className={`sidebar-filter ${filters.assignedUserId === user.id ? "sidebar-filter--active" : ""}`}
                    onClick={() => onSetFilters({ assignedUserId: user.id })}
                    type="button"
                  >
                    <span
                      className="sidebar-filter__dot"
                      style={{ background: user.colorHex }}
                    />
                    <span>{user.displayName}</span>
                    <span className="sidebar-filter__count">
                      {countMeetingsForUser(scopedMeetings, user.id)}
                    </span>
                  </button>
                ))}
              </section>

              <section className="sidebar-panel">
                <div className="section-header section-header--compact">
                  <div>
                    <div className="sidebar-section__label">Booking Summary</div>
                    <div className="sidebar-panel__title">
                      {scopedFilteredMeetings.length} visible bookings
                    </div>
                  </div>
                  <button className="sidebar-reset" onClick={onResetFilters} type="button">
                    Reset
                  </button>
                </div>

                <div className="sidebar-stats">
                  <div className="sidebar-stat sidebar-stat--wide sidebar-stat--alert">
                    <span className="sidebar-stat__icon" aria-hidden="true">
                      !
                    </span>
                    <span className="sidebar-stat__val sidebar-stat__val--amber">
                      {unassignedCount}
                    </span>
                    <span className="sidebar-stat__label">Unassigned</span>
                  </div>
                  <div className="sidebar-stat">
                    <span className="sidebar-stat__val sidebar-stat__val--blue">
                      {assignedCount}
                    </span>
                    <span className="sidebar-stat__label">Assigned</span>
                  </div>
                  <div className="sidebar-stat">
                    <span className="sidebar-stat__val sidebar-stat__val--green">
                      {briefedCount}
                    </span>
                    <span className="sidebar-stat__label">Has brief</span>
                  </div>
                </div>

                <div className="sidebar-meta">
                  <div>Last sync: {formatSyncTimestamp(lastSuccessfulSyncAt)}</div>
                  {syncMessage ? <div>{syncMessage}</div> : null}
                  <div>Selection scope: {selectedAssigneeCount} bookings</div>
                </div>
              </section>
            </>
          )}
        </aside>

        <main className="main-content">
          {activeSurfaceMode === "admin" ? (
            <AdminPanel
              currentUserId={session.user.id}
              isBusy={syncStatus === "syncing"}
              onCreate={onCreateUser}
              onDelete={onDeleteUser}
              onUpdate={onUpdateUser}
              users={users}
            />
          ) : activeSurfaceMode === "create" ? (
            <CreateMeetingPanel
              isSubmitting={syncStatus === "syncing"}
              onSubmit={onCreateMeetingRequest}
            />
          ) : activeSurfaceMode === "current" ? (
            <CurrentMeetingPanel
              meeting={currentMeeting}
              onClear={onClearCurrentMeeting}
              onGenerateGuide={onGenerateMeetingGuide}
              onLoadSavedGuide={onLoadSavedMeetingGuide}
              onOpenUrl={onOpenUrl}
              onSaveGuide={onSaveMeetingGuide}
              onUnlockGuide={onUnlockMeetingGuide}
            />
          ) : (
            <>
              <div className="main-toolbar">
                <div className="main-toolbar__left">
                  <div>
                    <div className="sidebar-section__label">Workspace</div>
                    <h1 className="main-title">
                      {activeSurfaceMode === "past" ? "Past Meetings" : "Upcoming Meetings"}
                    </h1>
                  </div>
                  <span className="main-count">
                    {scopedFilteredMeetings.length} meeting
                    {scopedFilteredMeetings.length === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="main-toolbar__right">
                  <button
                    className={`my-meetings-btn ${filters.assignedUserId === session.user.id ? "my-meetings-btn--active" : ""}`}
                    onClick={() =>
                      onSetFilters({
                        assignedUserId:
                          filters.assignedUserId === session.user.id ? "all" : session.user.id,
                      })
                    }
                    type="button"
                  >
                    <span
                      className="my-meetings-btn__dot"
                      style={{ background: session.user.colorHex }}
                    />
                    <span>My Meetings</span>
                  </button>
                  <div className="toggle-group">
                    <button
                      className={`toggle-btn ${viewMode === "list" ? "toggle-btn--active" : ""}`}
                      onClick={() => onSetViewMode("list")}
                      type="button"
                    >
                      List
                    </button>
                    <button
                      className={`toggle-btn ${viewMode === "calendar" ? "toggle-btn--active" : ""}`}
                      onClick={() => onSetViewMode("calendar")}
                      type="button"
                    >
                      Calendar
                    </button>
                  </div>
                </div>
              </div>

              <div className="meetings-layout">
                {viewMode === "list" ? (
                  <MeetingList
                    meetings={scopedFilteredMeetings}
                    onSelect={(meetingId) =>
                      selectedMeeting?.id === meetingId
                        ? onCloseMeeting()
                        : onSelectMeeting(meetingId)
                    }
                    selectedMeetingId={selectedMeeting?.id ?? null}
                  />
                ) : (
                  <div className="meetings-calendar">
                    <MeetingCalendar
                      meetings={scopedFilteredMeetings}
                      onSelect={onSelectMeeting}
                    />
                  </div>
                )}

                {selectedMeeting ? (
                  <MeetingDetailDrawer
                    canResolve={canAccessAdmin && activeSurfaceMode === "meetings"}
                    isSaving={syncStatus === "syncing"}
                    meeting={selectedMeeting}
                    onAssign={onAssign}
                    onClose={onCloseMeeting}
                    onOpenUrl={onOpenUrl}
                    onResolve={onResolveMeeting}
                    onStartCurrentMeeting={onStartCurrentMeeting}
                    users={users}
                  />
                ) : null}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
};

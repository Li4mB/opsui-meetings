import type { Meeting, User } from "@opsui/shared";
import { formatMeetingTimeChip, formatMeetingWindow } from "../lib/date";
import {
  getCountryFlag,
  getCountryLabel,
  getMeetingTypeTone,
  getModuleColor,
  getInitials,
} from "../lib/ui";
import { SelectMenu } from "./SelectMenu";

type Props = {
  meeting: Meeting | null;
  users: User[];
  isSaving: boolean;
  canResolve: boolean;
  onClose: () => void;
  onAssign: (meetingId: string, assignedUserId: string | null) => Promise<void>;
  onResolve: (meetingId: string) => Promise<void>;
  onStartCurrentMeeting: (meeting: Meeting) => Promise<void>;
  onOpenUrl: (url: string) => Promise<void>;
};

export const MeetingDetailDrawer = ({
  meeting,
  users,
  isSaving,
  canResolve,
  onClose,
  onAssign,
  onResolve,
  onStartCurrentMeeting,
  onOpenUrl,
}: Props) => {
  if (!meeting) {
    return null;
  }

  const typeTone = getMeetingTypeTone(meeting.meetingType);
  const activeAssignee =
    users.find((user) => user.id === meeting.assignedUserId) ?? null;
  const assigneeOptions = [
    {
      value: "",
      label: "Unassigned",
      dotColor: "#F87171",
      tone: "danger" as const,
    },
    ...users
      .filter((user) => user.active)
      .map((user) => ({
        value: user.id,
        label: user.displayName,
        dotColor: user.colorHex,
      })),
  ];

  return (
    <aside className="detail-panel">
      <div className="detail-panel__header">
        <div>
          <div className="detail-panel__title">{meeting.title}</div>
          <div className="detail-panel__subtitle">
            {meeting.clientName} - {meeting.company}
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} type="button">
          Close
        </button>
      </div>

      <div className="detail-section">
        <div className="detail-row">
          <span className="detail-label">Date &amp; time</span>
          <span className="detail-value">{formatMeetingWindow(meeting)}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Time chip</span>
          <span className="detail-value">
            {formatMeetingTimeChip(meeting.startAtUtc)}
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Meeting type</span>
          <span className={`type-badge type-badge--${typeTone}`}>
            {meeting.meetingType}
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Country</span>
          <span className="detail-value">
            {getCountryFlag(meeting.country)} {getCountryLabel(meeting.country)}
          </span>
        </div>
      </div>

      <div className="detail-divider" />

      <div className="detail-section">
        <div className="detail-section__label">Client information</div>
        <div className="detail-row">
          <span className="detail-label">Name</span>
          <span className="detail-value">{meeting.clientName}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Email</span>
          {meeting.clientEmail ? (
            <a className="detail-link" href={`mailto:${meeting.clientEmail}`}>
              {meeting.clientEmail}
            </a>
          ) : (
            <span className="detail-value">Not available</span>
          )}
        </div>
        <div className="detail-row">
          <span className="detail-label">Phone</span>
          <span className="detail-value">{meeting.phone ?? "Not available"}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Company size</span>
          <span className="detail-value">
            {meeting.companySize ?? "Not available"}
          </span>
        </div>
      </div>

      <div className="detail-divider" />

      <div className="detail-section">
        <div className="detail-section__label">Modules of interest</div>
        <div className="detail-modules">
          {meeting.modulesOfInterest.length ? (
            meeting.modulesOfInterest.map((module) => {
              const color = getModuleColor(module);

              return (
                <span
                  className="module-chip module-chip--lg"
                  key={module}
                  style={{
                    background: `${color}22`,
                    borderColor: `${color}44`,
                    color,
                  }}
                >
                  {module}
                </span>
              );
            })
          ) : (
            <span className="detail-value">No modules listed</span>
          )}
        </div>
      </div>

      <div className="detail-divider" />

      <div className="detail-section">
        <div className="detail-section__label">Meeting launch</div>
        {meeting.googleMeetUrl ? (
          <button
            className="start-meeting-btn"
            onClick={() => void onStartCurrentMeeting(meeting)}
            type="button"
          >
            <span className="start-meeting-btn__icon">ST</span>
            <span>
              <strong>Start Meeting</strong>
              <small>Open the Current Meeting workspace and launch Google Meet</small>
            </span>
          </button>
        ) : (
          <div className="detail-value">No Google Meet link is attached to this event.</div>
        )}
      </div>

      <div className="detail-divider" />

      <div className="detail-section">
        <div className="detail-section__label">Meeting links</div>
        {meeting.googleDocUrl ? (
          <button
            className="link-btn link-btn--doc"
            onClick={() => void onOpenUrl(meeting.googleDocUrl!)}
            type="button"
          >
            <span className="link-btn__icon">BR</span> View brief document
          </button>
        ) : null}
        {meeting.calendarHtmlUrl ? (
          <button
            className="link-btn link-btn--calendar"
            onClick={() => void onOpenUrl(meeting.calendarHtmlUrl!)}
            type="button"
          >
            <span className="link-btn__icon">GC</span> Open in Google Calendar
          </button>
        ) : null}
        {!meeting.googleMeetUrl &&
        !meeting.googleDocUrl &&
        !meeting.calendarHtmlUrl ? (
          <div className="detail-value">No linked assets found on this event.</div>
        ) : null}
      </div>

      <div className="detail-divider" />

      <div className="detail-section">
        <div className="detail-section__label">Assigned to</div>
        <SelectMenu
          className="detail-select"
          disabled={isSaving}
          onChange={(nextValue) => void onAssign(meeting.id, nextValue || null)}
          options={assigneeOptions}
          value={meeting.assignedUserId ?? ""}
        />

        {activeAssignee ? (
          <div className="assignee-row">
            <div
              className="avatar"
              style={{
                width: 36,
                height: 36,
                background: activeAssignee.colorHex,
                fontSize: 13,
              }}
            >
              {getInitials(activeAssignee.displayName)}
            </div>
            <div>
              <div className="assignee-name">{activeAssignee.displayName}</div>
              <div className="assignee-email">{activeAssignee.username}</div>
            </div>
          </div>
        ) : (
          <div className="assignee-row assignee-row--empty">
            <span className="assignee-email">No owner assigned yet</span>
          </div>
        )}
      </div>

      <div className="detail-divider" />

      <div className="detail-section">
        <div className="detail-section__label">Event description</div>
        <p className="detail-notes">
          {meeting.descriptionRaw || "No description provided."}
        </p>
      </div>

      {canResolve ? (
        <>
          <div className="detail-divider" />

          <div className="detail-section">
            <div className="detail-section__label">Resolution</div>
            <button
              className="resolve-btn"
              disabled={isSaving}
              onClick={() => {
                if (
                  window.confirm(
                    `Move "${meeting.clientName} - ${meeting.company}" to Past Meetings?`,
                  )
                ) {
                  void onResolve(meeting.id);
                }
              }}
              type="button"
            >
              <span className="resolve-btn__icon">RS</span>
              <span>
                <strong>Resolve meeting</strong>
                <small>Move this booking out of the active meetings queue</small>
              </span>
            </button>
          </div>
        </>
      ) : null}
    </aside>
  );
};

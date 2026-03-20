import type { CSSProperties } from "react";
import type { Meeting } from "@opsui/shared";
import {
  formatMeetingGroupLabel,
  formatMeetingTimeChip,
} from "../lib/date";
import {
  getCountryFlag,
  getCountryLabel,
  getMeetingTypeTone,
  getModuleColor,
} from "../lib/ui";

type Props = {
  meetings: Meeting[];
  selectedMeetingId: string | null;
  onSelect: (meetingId: string) => void;
  variant?: "active" | "past";
};

export const MeetingList = ({
  meetings,
  selectedMeetingId,
  onSelect,
  variant = "active",
}: Props) => {
  if (variant === "past") {
    const pastMeetings = [...meetings].sort((left, right) =>
      right.startAtUtc.localeCompare(left.startAtUtc),
    );

    if (!pastMeetings.length) {
      return (
        <div className="meetings-list meetings-list--past">
          <div className="empty-state">
            <h3>No past meetings yet</h3>
            <p>Resolved meetings will appear here once they leave the active queue.</p>
          </div>
        </div>
      );
    }

    return (
      <div className={`meetings-list meetings-list--past ${selectedMeetingId ? "meetings-list--narrow" : ""}`}>
        <div className="past-table">
          <div className="past-table__head">
            <span>Date</span>
            <span>Time</span>
            <span>Client</span>
            <span>Company</span>
            <span>Assigned</span>
            <span>Status</span>
          </div>

          {pastMeetings.map((meeting) => (
            <button
              className={`past-table__row ${selectedMeetingId === meeting.id ? "past-table__row--selected" : ""}`}
              key={meeting.id}
              onClick={() => onSelect(meeting.id)}
              type="button"
            >
              <span>{formatMeetingGroupLabel(meeting.startAtUtc)}</span>
              <span className="past-table__mono">
                {formatMeetingTimeChip(meeting.startAtUtc)}
              </span>
              <span>{meeting.clientName}</span>
              <span>{meeting.company}</span>
              <span>{meeting.assignedUserName ?? "Unassigned"}</span>
              <span className="status-badge status-completed">Resolved</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const groups = meetings.reduce<Record<string, Meeting[]>>((accumulator, meeting) => {
    const key = formatMeetingGroupLabel(meeting.startAtUtc);
    accumulator[key] ??= [];
    accumulator[key].push(meeting);
    return accumulator;
  }, {});

  const labels = Object.keys(groups);

  if (!labels.length) {
    return (
      <div className="meetings-list">
        <div className="empty-state">
          <h3>No meetings match these filters</h3>
          <p>Try broadening the country, assignee, or search filters.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`meetings-list ${selectedMeetingId ? "meetings-list--narrow" : ""}`}>
      {labels.map((label) => (
        <section className="date-group" key={label}>
          <div className="date-group__header">
            <span>{label}</span>
            <span>{groups[label].length} bookings</span>
          </div>

          {groups[label]
            .slice()
            .sort((left, right) => left.startAtUtc.localeCompare(right.startAtUtc))
            .map((meeting) => {
              const typeTone = getMeetingTypeTone(meeting.meetingType);

              return (
                <button
                  className={`meeting-card ${selectedMeetingId === meeting.id ? "meeting-card--selected" : ""}`}
                  key={meeting.id}
                  onClick={() => onSelect(meeting.id)}
                  style={
                    {
                      "--assignee-color": meeting.assignedUserColor ?? "#3B82F6",
                    } as CSSProperties
                  }
                  type="button"
                >
                  <div className="meeting-card__accent" />

                  <div className="meeting-card__body">
                    <div className="meeting-card__top">
                      <div className="meeting-card__datetime">
                        <span className="meeting-card__time">
                          {formatMeetingTimeChip(meeting.startAtUtc)}
                        </span>
                      </div>

                      <div className="meeting-card__badges">
                        <span
                          className={`type-badge type-badge--${typeTone}`}
                          title={meeting.meetingType}
                        >
                          {meeting.meetingType}
                        </span>
                        <span className="country-badge">
                          {getCountryFlag(meeting.country)} {getCountryLabel(meeting.country)}
                        </span>
                      </div>
                    </div>

                    <div className="meeting-card__client">
                      <span className="flag">{getCountryFlag(meeting.country)}</span>
                      <div>
                        <div className="meeting-card__name">{meeting.clientName}</div>
                        <div className="meeting-card__company">{meeting.company}</div>
                      </div>
                    </div>

                    <div className="meeting-card__footer">
                      <div className="meeting-card__modules">
                        {meeting.modulesOfInterest.slice(0, 3).map((module) => (
                          <span
                            className="module-chip"
                            key={module}
                            style={{
                              background: `${getModuleColor(module)}22`,
                              borderColor: `${getModuleColor(module)}44`,
                              color: getModuleColor(module),
                            }}
                          >
                            {module}
                          </span>
                        ))}
                        {meeting.modulesOfInterest.length > 3 ? (
                          <span className="module-chip module-chip--more">
                            +{meeting.modulesOfInterest.length - 3}
                          </span>
                        ) : null}
                        {!meeting.modulesOfInterest.length ? (
                          <span className="module-chip module-chip--more">
                            No modules listed
                          </span>
                        ) : null}
                      </div>

                      <div className="meeting-card__assignee">
                        <span
                          className="meeting-card__assignee-dot"
                          style={{
                            background:
                              meeting.assignedUserColor ?? "rgba(122, 132, 153, 0.7)",
                          }}
                        />
                        <span>{meeting.assignedUserName ?? "Unassigned"}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
        </section>
      ))}
    </div>
  );
};

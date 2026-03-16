import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import listPlugin from "@fullcalendar/list";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { Meeting } from "@opsui/shared";

type Props = {
  meetings: Meeting[];
  onSelect: (meetingId: string) => void;
};

export const MeetingCalendar = ({ meetings, onSelect }: Props) => (
  <div className="calendar-shell">
    <FullCalendar
      plugins={[dayGridPlugin, timeGridPlugin, listPlugin]}
      initialView="timeGridWeek"
      height="auto"
      timeZone="local"
      headerToolbar={{
        left: "prev,next today",
        center: "title",
        right: "dayGridMonth,timeGridWeek,listWeek",
      }}
      events={meetings.map((meeting) => ({
        id: meeting.id,
        title: `${meeting.clientName} • ${meeting.company}`,
        start: meeting.startAtUtc,
        end: meeting.endAtUtc,
        backgroundColor: meeting.assignedUserColor ?? "#38BDF8",
        borderColor: meeting.assignedUserColor ?? "#38BDF8",
      }))}
      eventClick={(event) => onSelect(event.event.id)}
      eventContent={(event) => (
        <div className="fc-event-card">
          <strong>{event.timeText}</strong>
          <span>{event.event.title}</span>
        </div>
      )}
    />
  </div>
);

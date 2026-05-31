import { format } from "date-fns";
import type { LoftBooking } from "@opsui/shared";

type Props = {
  bookings: LoftBooking[];
};

const formatSubmittedAt = (isoString: string) => {
  const value = new Date(isoString);

  if (Number.isNaN(value.getTime())) {
    return isoString;
  }

  return format(value, "EEEE d MMMM yyyy, h:mm a");
};

export const LoftList = ({ bookings }: Props) => {
  const sorted = [...bookings].sort((left, right) =>
    right.submittedAt.localeCompare(left.submittedAt),
  );

  if (!sorted.length) {
    return (
      <div className="meetings-list">
        <div className="empty-state">
          <h3>No Loft enquiries yet</h3>
          <p>New website enquiries from LoftAU will appear here as they arrive.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="meetings-list">
      <section className="date-group">
        <div className="date-group__header">
          <span>Loft enquiries</span>
          <span>{sorted.length} bookings</span>
        </div>

        {sorted.map((booking) => (
          <div className="meeting-card" key={booking.id}>
            <div className="meeting-card__accent" />

            <div className="meeting-card__body">
              <div className="meeting-card__top">
                <div className="meeting-card__datetime">
                  <span className="meeting-card__time">
                    {formatSubmittedAt(booking.submittedAt)}
                  </span>
                </div>
              </div>

              <div className="meeting-card__client">
                <div>
                  <div className="meeting-card__name">{booking.name}</div>
                  {booking.business ? (
                    <div className="meeting-card__company">{booking.business}</div>
                  ) : null}
                </div>
              </div>

              <div className="meeting-card__footer">
                <div className="meeting-card__modules">
                  {booking.email ? (
                    <span className="module-chip">{booking.email}</span>
                  ) : null}
                  {booking.phone ? (
                    <span className="module-chip">{booking.phone}</span>
                  ) : null}
                  {!booking.email && !booking.phone ? (
                    <span className="module-chip module-chip--more">
                      No contact details
                    </span>
                  ) : null}
                </div>
              </div>

              {booking.message ? (
                <p className="meeting-card__message">{booking.message}</p>
              ) : null}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
};

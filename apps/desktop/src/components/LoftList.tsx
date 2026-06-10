import { useState } from "react";
import { format } from "date-fns";
import {
  LOFT_PACKAGES,
  loftPackageKeys,
  type LoftBooking,
  type LoftPackageKey,
} from "@opsui/shared";

type SendStatus = "idle" | "sending" | "sent" | "error";

type Props = {
  bookings: LoftBooking[];
  onSendPaymentLink: (
    bookingId: string,
    packageKey: LoftPackageKey,
  ) => Promise<void>;
};

const formatSubmittedAt = (isoString: string) => {
  const value = new Date(isoString);

  if (Number.isNaN(value.getTime())) {
    return isoString;
  }

  return format(value, "EEEE d MMMM yyyy, h:mm a");
};

export const LoftList = ({ bookings, onSendPaymentLink }: Props) => {
  const [packageByBooking, setPackageByBooking] = useState<
    Record<string, LoftPackageKey>
  >({});
  const [statusByBooking, setStatusByBooking] = useState<
    Record<string, SendStatus>
  >({});
  const [errorByBooking, setErrorByBooking] = useState<Record<string, string>>(
    {},
  );

  const sorted = [...bookings].sort((left, right) =>
    right.submittedAt.localeCompare(left.submittedAt),
  );

  const handleSend = async (booking: LoftBooking) => {
    const packageKey = packageByBooking[booking.id] ?? "connect";

    setStatusByBooking((current) => ({ ...current, [booking.id]: "sending" }));
    setErrorByBooking((current) => ({ ...current, [booking.id]: "" }));

    try {
      await onSendPaymentLink(booking.id, packageKey);
      setStatusByBooking((current) => ({ ...current, [booking.id]: "sent" }));
    } catch (error) {
      setStatusByBooking((current) => ({ ...current, [booking.id]: "error" }));
      setErrorByBooking((current) => ({
        ...current,
        [booking.id]:
          error instanceof Error ? error.message : "Unable to send payment link",
      }));
    }
  };

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

        {sorted.map((booking) => {
          const status = statusByBooking[booking.id] ?? "idle";
          const error = errorByBooking[booking.id];
          const selectedPackage = packageByBooking[booking.id] ?? "connect";
          const sending = status === "sending";

          return (
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
                      <div className="meeting-card__company">
                        {booking.business}
                      </div>
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

                <div className="loft-card__payment">
                  <select
                    className="loft-card__package"
                    value={selectedPackage}
                    disabled={!booking.email || sending}
                    onChange={(event) => {
                      const value = event.target.value as LoftPackageKey;
                      setPackageByBooking((current) => ({
                        ...current,
                        [booking.id]: value,
                      }));
                      // Reset feedback so a "sent ✓"/error never lingers against
                      // a package the operator hasn't actually sent.
                      setStatusByBooking((current) => ({
                        ...current,
                        [booking.id]: "idle",
                      }));
                      setErrorByBooking((current) => ({
                        ...current,
                        [booking.id]: "",
                      }));
                    }}
                  >
                    {loftPackageKeys.map((key) => {
                      const info = LOFT_PACKAGES[key];
                      return (
                        <option key={key} value={key}>
                          {info.name} — {info.setup} setup + {info.monthly}/mo
                        </option>
                      );
                    })}
                  </select>

                  <button
                    type="button"
                    className="link-btn link-btn--payment"
                    disabled={!booking.email || sending}
                    onClick={() => handleSend(booking)}
                  >
                    {sending
                      ? "Sending…"
                      : status === "sent"
                        ? "Resend payment link"
                        : "Send payment link"}
                  </button>

                  {status === "sent" ? (
                    <span className="loft-card__sent">Payment link sent ✓</span>
                  ) : null}
                  {!booking.email ? (
                    <span className="loft-card__hint">No email on file</span>
                  ) : null}
                  {status === "error" && error ? (
                    <span className="loft-card__error">{error}</span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
};

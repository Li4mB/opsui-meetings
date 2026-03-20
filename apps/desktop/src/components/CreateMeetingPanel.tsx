import { useState } from "react";
import type {
  CreateMeetingRequestInput,
  MeetingRequest,
  MeetingRequestCountry,
  MeetingRequestMeetingMode,
  MeetingRequestModule,
} from "@opsui/shared";
import { meetingRequestModuleOptions } from "@opsui/shared";

type Props = {
  isSubmitting: boolean;
  onSubmit: (input: CreateMeetingRequestInput) => Promise<MeetingRequest>;
};

const businessSizeOptions = [
  "1-5 employees",
  "6-20 employees",
  "21-50 employees",
  "51-200 employees",
  "201+ employees",
];

const countryOptions: MeetingRequestCountry[] = [
  "Australia",
  "New Zealand",
  "Unknown",
];

const meetingModeOptions: Array<{
  value: MeetingRequestMeetingMode;
  label: string;
  copy: string;
}> = [
  {
    value: "google_meet",
    label: "Google Meet",
    copy: "Remote intro call with a live Google Meet link.",
  },
  {
    value: "in_person",
    label: "In Person",
    copy: "Face-to-face meeting or onsite walkthrough.",
  },
];

const initialForm: CreateMeetingRequestInput = {
  clientName: "",
  email: "",
  phone: "",
  companyName: "",
  country: "Australia",
  businessSize: businessSizeOptions[0],
  modules: [],
  meetingMode: "google_meet",
  preferredDate: "",
  preferredTime: "",
  additionalInfo: "",
};

export const CreateMeetingPanel = ({ isSubmitting, onSubmit }: Props) => {
  const [form, setForm] = useState<CreateMeetingRequestInput>(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const allModulesSelected =
    form.modules.length === meetingRequestModuleOptions.length;

  const toggleModule = (module: MeetingRequestModule) => {
    setForm((current) => ({
      ...current,
      modules: current.modules.includes(module)
        ? current.modules.filter((item) => item !== module)
        : [...current.modules, module],
    }));
  };

  const handleSelectAllModules = () => {
    setForm((current) => ({
      ...current,
      modules: [...meetingRequestModuleOptions],
    }));
  };

  const handleSubmit = async () => {
    if (form.clientName.trim().length < 2) {
      setError("Client name must be at least 2 characters.");
      return;
    }

    if (!form.email.includes("@")) {
      setError("Enter a valid client email.");
      return;
    }

    if (form.phone.trim().length < 6) {
      setError("Enter a valid phone number.");
      return;
    }

    if (form.companyName.trim().length < 2) {
      setError("Company name must be at least 2 characters.");
      return;
    }

    if (!form.modules.length) {
      setError("Select at least one module of interest.");
      return;
    }

    if (!form.preferredDate || !form.preferredTime) {
      setError("Choose a preferred date and time.");
      return;
    }

    setError(null);

    const created = await onSubmit({
      ...form,
      clientName: form.clientName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      companyName: form.companyName.trim(),
      additionalInfo: form.additionalInfo.trim(),
    });

    setSuccessMessage(
      `Meeting intake saved for ${created.clientName} at ${created.companyName}.`,
    );
    setForm(initialForm);
  };

  return (
    <section className="create-meeting-shell">
      <div className="create-meeting-card">
        <div className="create-meeting-card__hero">
          <div>
            <div className="sidebar-section__label">Create a Meeting</div>
            <h1 className="create-meeting-title">Capture a new demo request</h1>
            <p className="create-meeting-subtitle">
              Enter the client details once, keep module interest structured, and
              give the team a clean intake before it becomes a booking.
            </p>
          </div>
          <div className="create-meeting-hero__pill">Internal intake workflow</div>
        </div>

        <div className="create-meeting-layout">
          <aside className="create-meeting-intro">
            <section className="create-meeting-intro__panel">
              <span className="eyebrow">What this captures</span>
              <h2>Pre-demo intake</h2>
              <p>
                Use this when the client details are known but the meeting still
                needs internal coordination and prep.
              </p>
            </section>

            <section className="create-meeting-intro__panel">
              <span className="eyebrow">Best practice</span>
              <ul className="create-meeting-checklist">
                <li>Use the client's real email and direct phone number.</li>
                <li>Pick every module they mention, even if early stage.</li>
                <li>Use additional info for pain points or key context.</li>
                <li>Choose the preferred date and time exactly as requested.</li>
              </ul>
            </section>
          </aside>

          <div className="create-meeting-form">
            <section className="create-meeting-section">
              <div className="create-meeting-section__header">
                <span className="eyebrow">Client Details</span>
                <h2>Who wants the demo</h2>
              </div>

              <div className="create-meeting-grid">
                <label>
                  Name
                  <input
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        clientName: event.target.value,
                      }))
                    }
                    placeholder="Jane Smith"
                    value={form.clientName}
                  />
                </label>

                <label>
                  Email
                  <input
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    placeholder="jane@company.com"
                    type="email"
                    value={form.email}
                  />
                </label>

                <label>
                  Country / Region
                  <select
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        country: event.target.value as MeetingRequestCountry,
                      }))
                    }
                    value={form.country}
                  >
                    {countryOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Phone Number
                  <input
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        phone: event.target.value,
                      }))
                    }
                    placeholder="0400 000 000"
                    value={form.phone}
                  />
                </label>

                <label>
                  Company Name
                  <input
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        companyName: event.target.value,
                      }))
                    }
                    placeholder="OpsUI"
                    value={form.companyName}
                  />
                </label>

                <label>
                  Business Size
                  <select
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        businessSize: event.target.value,
                      }))
                    }
                    value={form.businessSize}
                  >
                    {businessSizeOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="create-meeting-section">
              <div className="create-meeting-section__header create-meeting-section__header--modules">
                <button
                  className="create-meeting-select-all"
                  disabled={allModulesSelected}
                  onClick={handleSelectAllModules}
                  type="button"
                >
                  Select All
                </button>
                <div>
                  <span className="eyebrow">Modules</span>
                  <h2>What they want help with</h2>
                </div>
              </div>

              <div className="create-meeting-module-grid">
                {meetingRequestModuleOptions.map((module) => {
                  const selected = form.modules.includes(module);

                  return (
                    <button
                      key={module}
                      className={`create-meeting-module-card ${selected ? "create-meeting-module-card--selected" : ""}`}
                      onClick={() => toggleModule(module)}
                      type="button"
                    >
                      <span className="create-meeting-module-card__checkbox">
                        {selected ? "OK" : ""}
                      </span>
                      <span>{module}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="create-meeting-section">
              <div className="create-meeting-section__header">
                <span className="eyebrow">Meeting Preference</span>
                <h2>How and when they want to meet</h2>
              </div>

              <div className="create-meeting-mode-grid">
                {meetingModeOptions.map((option) => {
                  const selected = form.meetingMode === option.value;

                  return (
                    <button
                      key={option.value}
                      className={`create-meeting-mode-card ${selected ? "create-meeting-mode-card--selected" : ""}`}
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          meetingMode: option.value,
                        }))
                      }
                      type="button"
                    >
                      <span className="create-meeting-mode-card__dot" />
                      <div>
                        <strong>{option.label}</strong>
                        <p>{option.copy}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="create-meeting-grid create-meeting-grid--tight">
                <label>
                  Preferred Date
                  <input
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        preferredDate: event.target.value,
                      }))
                    }
                    type="date"
                    value={form.preferredDate}
                  />
                </label>

                <label>
                  Preferred Time
                  <input
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        preferredTime: event.target.value,
                      }))
                    }
                    type="time"
                    value={form.preferredTime}
                  />
                </label>
              </div>
            </section>

            <section className="create-meeting-section">
              <div className="create-meeting-section__header">
                <span className="eyebrow">Additional Context</span>
                <h2>Anything the rep should know</h2>
              </div>

              <label>
                Additional Info
                <textarea
                  className="create-meeting-textarea"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      additionalInfo: event.target.value,
                    }))
                  }
                  placeholder="Pain points, urgency, current tools, internal notes, or anything useful for the demo owner."
                  rows={5}
                  value={form.additionalInfo}
                />
              </label>
            </section>

            {error ? <div className="form-error">{error}</div> : null}
            {successMessage ? (
              <div className="create-meeting-success">{successMessage}</div>
            ) : null}

            <div className="create-meeting-actions">
              <button
                className="primary-button create-meeting-submit"
                disabled={isSubmitting}
                onClick={() => void handleSubmit()}
                type="button"
              >
                {isSubmitting ? "Saving intake..." : "Save Meeting Request"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

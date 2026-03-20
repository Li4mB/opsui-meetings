import { useEffect, useRef, useState } from "react";
import type { AiMeetingGuide, AiMeetingGuideBinding, Meeting } from "@opsui/shared";
import {
  formatMeetingTimeChip,
  formatMeetingWindow,
  formatSyncTimestamp,
} from "../lib/date";
import { getCountryFlag, getCountryLabel, getModuleColor } from "../lib/ui";

type Props = {
  meeting: Meeting | null;
  onClear: () => Promise<void>;
  onGenerateGuide: (meetingId: string) => Promise<AiMeetingGuide>;
  onLoadSavedGuide: (meetingId: string) => Promise<AiMeetingGuideBinding>;
  onOpenUrl: (url: string) => Promise<void>;
  onSaveGuide: (
    meetingId: string,
    guide: AiMeetingGuide,
  ) => Promise<AiMeetingGuideBinding>;
};

const getNotes = (raw: string) =>
  raw
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.toLowerCase().startsWith("drive brief notes") &&
        !line.startsWith("http") &&
        !/^-+$/.test(line) &&
        !line.includes("MEETING DETAILS") &&
        !line.includes("CLIENT INFORMATION") &&
        !line.includes("MODULES OF INTEREST") &&
        !line.includes("ADDITIONAL INFORMATION") &&
        !line.includes("MEET LINK"),
    );

export const CurrentMeetingPanel = ({
  meeting,
  onClear,
  onGenerateGuide,
  onLoadSavedGuide,
  onOpenUrl,
  onSaveGuide,
}: Props) => {
  const [guide, setGuide] = useState<AiMeetingGuide | null>(null);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [isGeneratingGuide, setIsGeneratingGuide] = useState(false);
  const [isGuideBound, setIsGuideBound] = useState(false);
  const [isGuideBindingBusy, setIsGuideBindingBusy] = useState(false);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "resetting"
  >("idle");
  const saveHoldTimeoutRef = useRef<number | null>(null);
  const saveResetTimeoutRef = useRef<number | null>(null);

  const clearSaveAnimationTimers = () => {
    if (saveHoldTimeoutRef.current) {
      window.clearTimeout(saveHoldTimeoutRef.current);
      saveHoldTimeoutRef.current = null;
    }

    if (saveResetTimeoutRef.current) {
      window.clearTimeout(saveResetTimeoutRef.current);
      saveResetTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    setGuide(null);
    setGuideError(null);
    setIsGeneratingGuide(false);
    setIsGuideBound(false);
    setIsGuideBindingBusy(false);
    setSaveState("idle");
    clearSaveAnimationTimers();
  }, [meeting?.id]);

  useEffect(
    () => () => {
      clearSaveAnimationTimers();
    },
    [],
  );

  useEffect(() => {
    if (!meeting) {
      return;
    }

    let active = true;

    const loadSavedGuide = async () => {
      try {
        const binding = await onLoadSavedGuide(meeting.id);

        if (!active) {
          return;
        }

        setGuide(binding.guide);
        setIsGuideBound(binding.locked);
      } catch (error) {
        if (!active) {
          return;
        }

        setGuideError(
          error instanceof Error
            ? error.message
            : "Unable to load the saved AI guide for this meeting.",
        );
      }
    };

    void loadSavedGuide();

    return () => {
      active = false;
    };
  }, [meeting?.id, onLoadSavedGuide]);

  if (!meeting) {
    return (
      <section className="current-meeting-shell">
        <div className="current-meeting-card">
          <div className="eyebrow">Current Meeting</div>
          <h1>No meeting is active</h1>
          <p>
            Use the Start Meeting action from a booking to open Google Meet and
            load the meeting brief here.
          </p>
        </div>
      </section>
    );
  }

  const notes = getNotes(meeting.descriptionRaw);

  const handleGenerateGuide = async () => {
    const wasGuideBound = isGuideBound;

    setIsGeneratingGuide(true);
    setGuideError(null);
    clearSaveAnimationTimers();
    setSaveState("idle");

    if (wasGuideBound) {
      setIsGuideBound(false);
    }

    try {
      const nextGuide = await onGenerateGuide(meeting.id);
      setGuide(nextGuide);
      setIsGuideBound(false);
    } catch (error) {
      setGuideError(
        error instanceof Error
          ? error.message
          : "Unable to generate the AI meeting guide right now.",
      );

      if (wasGuideBound) {
        setIsGuideBound(true);
      }
    } finally {
      setIsGeneratingGuide(false);
    }
  };

  const handleSaveGuide = async () => {
    if (!guide) {
      return;
    }

    setIsGuideBindingBusy(true);
    setGuideError(null);
    setSaveState("saving");

    try {
      const binding = await onSaveGuide(meeting.id, guide);
      setGuide(binding.guide ?? guide);
      setIsGuideBound(binding.locked);
      setSaveState("saved");
      clearSaveAnimationTimers();

      saveHoldTimeoutRef.current = window.setTimeout(() => {
        setSaveState("resetting");
        saveHoldTimeoutRef.current = null;

        saveResetTimeoutRef.current = window.setTimeout(() => {
          setSaveState("idle");
          saveResetTimeoutRef.current = null;
        }, 800);
      }, 3000);
    } catch (error) {
      setGuideError(
        error instanceof Error
          ? error.message
          : "Unable to update the saved guide for this meeting.",
      );
      setSaveState("idle");
    } finally {
      setIsGuideBindingBusy(false);
    }
  };

  const showSavedTick = isGuideBound;
  const isSaveAnimating =
    saveState === "saving" || saveState === "saved" || saveState === "resetting";
  const saveLabel =
    saveState === "saving"
      ? "Saving..."
      : saveState === "saved" || saveState === "resetting"
        ? "Saved"
        : "Save";

  return (
    <section className="current-meeting-shell">
      <div className="current-meeting-card current-meeting-card--wide">
        <div className="current-meeting-card__header">
          <div>
            <div className="eyebrow">Current Meeting</div>
            <h1>{meeting.title}</h1>
            <p>
              {meeting.clientName} - {meeting.company}
            </p>
          </div>
          <span className="current-meeting-badge">LIVE</span>
        </div>

        <div className="current-meeting-hero-pills">
          <span className="current-meeting-pill">
            {getCountryFlag(meeting.country)} {getCountryLabel(meeting.country)}
          </span>
          <span className="current-meeting-pill">{meeting.meetingType}</span>
          <span className="current-meeting-pill">
            Starts {formatMeetingTimeChip(meeting.startAtUtc)}
          </span>
          {meeting.assignedUserName ? (
            <span className="current-meeting-pill">
              Owner {meeting.assignedUserName}
            </span>
          ) : null}
        </div>

        <div className="current-meeting-overview">
          <div className="current-meeting-overview__item">
            <span>Meeting window</span>
            <strong>{formatMeetingWindow(meeting)}</strong>
          </div>
          <div className="current-meeting-overview__item">
            <span>Client contact</span>
            <strong>{meeting.clientEmail ?? "No email listed"}</strong>
          </div>
          <div className="current-meeting-overview__item">
            <span>Company size</span>
            <strong>{meeting.companySize ?? "Not provided"}</strong>
          </div>
          <div className="current-meeting-overview__item">
            <span>Last synced</span>
            <strong>{formatSyncTimestamp(meeting.lastSyncedAt)}</strong>
          </div>
        </div>

        <div className="current-meeting-context">
          <div className="current-meeting-main">
            <section className="current-meeting-section current-meeting-section--guide">
              <div className="current-meeting-section__header current-meeting-section__header--with-action">
                <div>
                  <span className="eyebrow">AI Meeting Guide</span>
                  <h2>Live script and demo plan</h2>
                </div>
                <div className="current-meeting-ai-actions">
                  {guide ? (
                    <div className="current-meeting-ai-meta">
                      {guide.model} | {formatSyncTimestamp(guide.generatedAt)}
                    </div>
                  ) : null}

                  {guide ? (
                    <div className="current-meeting-guide-actions">
                      {showSavedTick ? (
                        <span
                          aria-label="Guide is saved"
                          className="current-meeting-guide-saved-indicator"
                          title="Guide is saved"
                        >
                          <span
                            aria-hidden="true"
                            className="current-meeting-guide-saved-indicator__check"
                          />
                        </span>
                      ) : null}

                      <div
                        className={`current-meeting-guide-pill ${saveState === "saving" ? "current-meeting-guide-pill--saving" : ""} ${saveState === "saved" ? "current-meeting-guide-pill--saved" : ""} ${saveState === "resetting" ? "current-meeting-guide-pill--resetting" : ""} ${isGuideBound && !isSaveAnimating ? "current-meeting-guide-pill--bound" : ""}`}
                      >
                        <span className="current-meeting-guide-pill__fill" aria-hidden="true" />
                        <button
                          aria-label="Save AI meeting guide"
                          className="current-meeting-guide-pill__action current-meeting-guide-pill__action--save"
                          disabled={isGuideBound || isGuideBindingBusy || isSaveAnimating}
                          onClick={() => void handleSaveGuide()}
                          type="button"
                        >
                          {saveLabel === "Saved" ? (
                            <span className="current-meeting-guide-pill__save-copy">
                              <span
                                className="current-meeting-guide-pill__check"
                                aria-hidden="true"
                              />
                              <span>{saveLabel}</span>
                            </span>
                          ) : (
                            <span className="current-meeting-guide-pill__save-copy">
                              <span>{saveLabel}</span>
                            </span>
                          )}
                        </button>

                        <span className="current-meeting-guide-pill__divider" aria-hidden="true" />

                        <button
                          className="current-meeting-guide-pill__action current-meeting-guide-pill__action--refresh"
                          disabled={isGeneratingGuide || isGuideBindingBusy}
                          onClick={() => void handleGenerateGuide()}
                          type="button"
                        >
                          {isGeneratingGuide ? "Generating..." : "Refresh Guide"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="current-meeting-btn current-meeting-btn--guide"
                      disabled={isGeneratingGuide}
                      onClick={() => void handleGenerateGuide()}
                      type="button"
                    >
                      {isGeneratingGuide ? "Generating..." : "Generate AI Guide"}
                    </button>
                  )}
                </div>
              </div>

              {guideError ? (
                <div className="current-meeting-ai-error">{guideError}</div>
              ) : null}

              {guide ? (
                <div className="current-meeting-ai-grid">
                  <article className="current-meeting-ai-card current-meeting-ai-card--wide">
                    <span className="eyebrow">Meeting Summary</span>
                    <p>{guide.meetingSummary}</p>
                  </article>

                  <article className="current-meeting-ai-card current-meeting-ai-card--wide">
                    <span className="eyebrow">Recommended Opening</span>
                    <p>{guide.recommendedOpening}</p>
                  </article>

                  <article className="current-meeting-ai-card">
                    <span className="eyebrow">Discovery Questions</span>
                    <ul className="current-meeting-ai-list">
                      {guide.discoveryQuestions.map((question) => (
                        <li key={question}>{question}</li>
                      ))}
                    </ul>
                  </article>

                  <article className="current-meeting-ai-card">
                    <span className="eyebrow">Close Strategy</span>
                    <p>{guide.closeStrategy}</p>
                  </article>

                  <article className="current-meeting-ai-card">
                    <span className="eyebrow">Modules To Emphasize</span>
                    <div className="current-meeting-ai-stack">
                      {guide.recommendedModules.length ? (
                        guide.recommendedModules.map((item) => {
                          const color = getModuleColor(item.module);

                          return (
                            <div
                              className="current-meeting-ai-rows"
                              key={`${item.module}-${item.reason}`}
                            >
                              <span
                                className="current-meeting-module"
                                style={{
                                  background: `${color}1f`,
                                  borderColor: `${color}40`,
                                  color,
                                }}
                              >
                                {item.module}
                              </span>
                              <p>{item.reason}</p>
                            </div>
                          );
                        })
                      ) : (
                        <div className="current-meeting-empty">
                          No module recommendations returned
                        </div>
                      )}
                    </div>
                  </article>

                  <article className="current-meeting-ai-card">
                    <span className="eyebrow">Objection Handling</span>
                    <div className="current-meeting-ai-stack">
                      {guide.objectionHandling.length ? (
                        guide.objectionHandling.map((item) => (
                          <div
                            className="current-meeting-ai-rows"
                            key={`${item.objection}-${item.guidance}`}
                          >
                            <strong>{item.objection}</strong>
                            <p>{item.guidance}</p>
                          </div>
                        ))
                      ) : (
                        <div className="current-meeting-empty">
                          No objections identified
                        </div>
                      )}
                    </div>
                  </article>

                  <article className="current-meeting-ai-card current-meeting-ai-card--wide">
                    <span className="eyebrow">Talk Track Steps</span>
                    <div className="current-meeting-ai-stack">
                      {guide.talkTrackSteps.map((item) => (
                        <div
                          className="current-meeting-ai-step"
                          key={`${item.step}-${item.guidance}`}
                        >
                          <div className="current-meeting-ai-step__index">{item.step}</div>
                          <p>{item.guidance}</p>
                        </div>
                      ))}
                    </div>
                  </article>

                  <article className="current-meeting-ai-card current-meeting-ai-card--wide">
                    <span className="eyebrow">Source Context</span>
                    <ul className="current-meeting-ai-list current-meeting-ai-list--context">
                      {guide.sourceContext.length ? (
                        guide.sourceContext.map((item) => <li key={item}>{item}</li>)
                      ) : (
                        <li>No additional OpsUI knowledge context was returned.</li>
                      )}
                    </ul>
                  </article>
                </div>
              ) : (
                <div className="current-meeting-ai-placeholder">
                  <p>
                    Generate an AI guide to get a call opening, discovery questions,
                    module emphasis, objection handling, and a closing plan grounded
                    in this meeting brief.
                  </p>
                </div>
              )}
            </section>

            <section className="current-meeting-section">
              <div className="current-meeting-section__header">
                <span className="eyebrow">Client Information</span>
                <h2>Who is on the call</h2>
              </div>
              <div className="current-meeting-info-grid">
                <div className="current-meeting-info-card">
                  <span>Name</span>
                  <strong>{meeting.clientName}</strong>
                </div>
                <div className="current-meeting-info-card">
                  <span>Company</span>
                  <strong>{meeting.company}</strong>
                </div>
                <div className="current-meeting-info-card current-meeting-info-card--email">
                  <span>Email</span>
                  <strong title={meeting.clientEmail ?? "Not provided"}>
                    {meeting.clientEmail ?? "Not provided"}
                  </strong>
                </div>
                <div className="current-meeting-info-card">
                  <span>Phone</span>
                  <strong>{meeting.phone ?? "Not provided"}</strong>
                </div>
              </div>
            </section>

            <section className="current-meeting-section">
              <div className="current-meeting-section__header">
                <span className="eyebrow">Modules of Interest</span>
                <h2>What they care about</h2>
              </div>
              <div className="current-meeting-modules">
                {meeting.modulesOfInterest.length ? (
                  meeting.modulesOfInterest.map((module) => {
                    const color = getModuleColor(module);

                    return (
                      <span
                        className="current-meeting-module"
                        key={module}
                        style={{
                          background: `${color}1f`,
                          borderColor: `${color}40`,
                          color,
                        }}
                      >
                        {module}
                      </span>
                    );
                  })
                ) : (
                  <div className="current-meeting-empty">No modules listed</div>
                )}
              </div>
            </section>

            <section className="current-meeting-section">
              <div className="current-meeting-section__header">
                <span className="eyebrow">Brief Summary</span>
                <h2>What to know before you speak</h2>
              </div>
              <div className="current-meeting-notes">
                {notes.length ? (
                  notes.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)
                ) : (
                  <p>No additional notes were found in the synced brief.</p>
                )}
              </div>
            </section>
          </div>

          <aside className="current-meeting-side">
            <section className="current-meeting-section current-meeting-section--side">
              <div className="current-meeting-section__header">
                <span className="eyebrow">Meeting Assets</span>
                <h2>Quick actions</h2>
              </div>
              <div className="current-meeting-link-stack">
                {meeting.googleMeetUrl ? (
                  <button
                    className="current-meeting-link current-meeting-link--meet"
                    onClick={() => void onOpenUrl(meeting.googleMeetUrl!)}
                    type="button"
                  >
                    <span>ME</span>
                    <strong>Join Meet</strong>
                  </button>
                ) : null}
                {meeting.googleDocUrl ? (
                  <button
                    className="current-meeting-link current-meeting-link--doc"
                    onClick={() => void onOpenUrl(meeting.googleDocUrl!)}
                    type="button"
                  >
                    <span>BR</span>
                    <strong>Open Brief Document</strong>
                  </button>
                ) : null}
                {meeting.calendarHtmlUrl ? (
                  <button
                    className="current-meeting-link current-meeting-link--calendar"
                    onClick={() => void onOpenUrl(meeting.calendarHtmlUrl!)}
                    type="button"
                  >
                    <span>GC</span>
                    <strong>Open Calendar Event</strong>
                  </button>
                ) : null}
              </div>
            </section>

            <section className="current-meeting-section current-meeting-section--side">
              <div className="current-meeting-section__header">
                <span className="eyebrow">Meeting Control</span>
                <h2>Keep the workspace clean</h2>
              </div>
              <div className="current-meeting-note">
                Google Meet opens alongside this page. Keep this panel open for
                client context, notes, and quick access to the brief.
              </div>
              <div className="current-meeting-actions">
                <button
                  className="current-meeting-btn current-meeting-btn--primary"
                  onClick={() => void onClear()}
                  type="button"
                >
                  End Current Meeting
                </button>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
};

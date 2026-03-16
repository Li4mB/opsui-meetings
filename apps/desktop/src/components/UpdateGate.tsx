import type { UpdateState } from "../lib/updater";

type Props = {
  updateState: UpdateState;
  onInstall: () => Promise<void>;
};

export const UpdateGate = ({ updateState, onInstall }: Props) => {
  if (updateState.status === "checking") {
    return (
      <div className="update-gate">
        <div className="update-card">
          <div className="eyebrow">Checking release channel</div>
          <h1>Preparing OpsUI Meetings</h1>
          <p>Verifying whether this installation is on the required version.</p>
        </div>
      </div>
    );
  }

  if (updateState.status === "ready") {
    return null;
  }

  const isInstalling = updateState.status === "installing";
  const version = updateState.update.version;

  return (
    <div className="update-gate">
      <div className="update-card">
        <div className="eyebrow">Mandatory update</div>
        <h1>Version {version} is required to continue.</h1>
        <p>
          Access is blocked until the latest approved OpsUI Meetings release is
          installed.
        </p>

        {updateState.update.body ? (
          <div className="update-notes">{updateState.update.body}</div>
        ) : null}

        <div className="progress-shell">
          <div
            className="progress-fill"
            style={{ width: `${Math.round(updateState.progress * 100)}%` }}
          />
        </div>

        <div className="update-meta">
          {updateState.message ?? (isInstalling ? "Installing update..." : "Ready to install")}
        </div>

        <button
          className="primary-button"
          disabled={isInstalling}
          onClick={() => void onInstall()}
          type="button"
        >
          {isInstalling ? "Installing..." : "Update now"}
        </button>
      </div>
    </div>
  );
};

import { useState } from "react";
import type { AuthBootstrapUser } from "@opsui/shared";
import opsLogo from "../assets/op.png";

type Props = {
  approvedUsers: AuthBootstrapUser[];
  isLoading: boolean;
  error: string | null;
  onSubmit: (input: { username: string; password: string }) => Promise<void>;
};

export const LoginScreen = ({ approvedUsers, isLoading, error, onSubmit }: Props) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit({ username, password });
  };

  return (
    <div className="login-shell">
      <section className="login-hero">
        <div className="login-brand">
          <span className="login-brand__mark">
            <img alt="OpsUI logo" className="login-brand__image" src={opsLogo} />
          </span>
          <span className="login-brand__wordmark">OpsUI Meetings Dashboard</span>
        </div>
        <div className="eyebrow">OpsUI Internal Platform</div>
        <h1>Meet every demo booking with the full picture.</h1>
        <p>
          OpsUI Meetings Dashboard gives the team a shared live calendar, fast assignment
          workflows, and offline access to recently synced bookings.
        </p>

        <div className="hero-grid">
          <div className="hero-card">
            <span>Calendar + list views</span>
            <strong>Team-wide visibility</strong>
          </div>
          <div className="hero-card">
            <span>Viewer-local timezones</span>
            <strong>No manual conversion</strong>
          </div>
          <div className="hero-card">
            <span>Google Meet + brief links</span>
            <strong>One-click prep</strong>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <div className="panel-badge">Approved OpsUI users only</div>
        <h2>Sign in</h2>
        <p className="panel-copy">
          Use your internal OpsUI username and password to continue. If you are signing in on
          a new machine, choose your username from the approved account list below.
        </p>

        {approvedUsers.length ? (
          <div className="login-directory">
            <div className="login-directory__label">Approved accounts</div>
            <div className="login-directory__list">
              {approvedUsers.map((user) => (
                <button
                  className={`login-directory__item ${username === user.username ? "login-directory__item--active" : ""}`}
                  key={user.username}
                  onClick={() => setUsername(user.username)}
                  type="button"
                >
                  <span
                    className="login-directory__dot"
                    style={{ background: user.colorHex }}
                  />
                  <span className="login-directory__copy">
                    <span className="login-directory__name">{user.displayName}</span>
                    <span className="login-directory__username">@{user.username}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            Username
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Enter your username"
            />
          </label>

          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
            />
          </label>

          {error ? <div className="form-error">{error}</div> : null}

          <button className="primary-button" disabled={isLoading} type="submit">
            {isLoading ? "Signing in..." : "Open OpsUI Meetings Dashboard"}
          </button>
        </form>
      </section>
    </div>
  );
};

import { useEffect, useState } from "react";
import type { CreateUserInput, UpdateUserInput, User } from "@opsui/shared";
import { getInitials } from "../lib/ui";
import { SelectMenu } from "./SelectMenu";

type Props = {
  users: User[];
  currentUserId: string;
  isBusy: boolean;
  onCreate: (input: CreateUserInput) => Promise<void>;
  onUpdate: (userId: string, input: UpdateUserInput) => Promise<void>;
  onDelete: (userId: string) => Promise<void>;
};

type Drafts = Record<
  string,
  {
    displayName: string;
    role: "admin" | "member";
    colorHex: string;
    active: boolean;
    password: string;
  }
>;

const buildDrafts = (users: User[]): Drafts =>
  Object.fromEntries(
    users.map((user) => [
      user.id,
      {
        displayName: user.displayName,
        role: user.role,
        colorHex: user.colorHex,
        active: user.active,
        password: "",
      },
    ]),
  );

const isUserDraftDirty = (
  user: User,
  draft: Drafts[string],
) =>
  draft.displayName.trim() !== user.displayName ||
  draft.role !== user.role ||
  draft.colorHex !== user.colorHex ||
  draft.active !== user.active ||
  draft.password.trim().length > 0;

export const AdminPanel = ({
  users,
  currentUserId,
  isBusy,
  onCreate,
  onUpdate,
  onDelete,
}: Props) => {
  const [drafts, setDrafts] = useState<Drafts>(() => buildDrafts(users));
  const [createError, setCreateError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string | null>>({});
  const [createForm, setCreateForm] = useState<CreateUserInput>({
    username: "",
    displayName: "",
    password: "",
    role: "member",
    colorHex: "#3B82F6",
  });
  const roleOptions = [
    { value: "member", label: "Member" },
    { value: "admin", label: "Admin", dotColor: "#60A5FA" },
  ];

  useEffect(() => {
    setDrafts(buildDrafts(users));
    setRowErrors({});
  }, [users]);

  const handleSaveUser = async (userId: string) => {
    const draft = drafts[userId];

    if (!draft) {
      return;
    }

    const displayName = draft.displayName.trim();

    if (displayName.length < 2) {
      setRowErrors((current) => ({
        ...current,
        [userId]: "Display name must be at least 2 characters.",
      }));
      return;
    }

    if (draft.password && draft.password.length < 8) {
      setRowErrors((current) => ({
        ...current,
        [userId]: "Password reset must be at least 8 characters.",
      }));
      return;
    }

    setRowErrors((current) => ({
      ...current,
      [userId]: null,
    }));

    await onUpdate(userId, {
      active: draft.active,
      colorHex: draft.colorHex,
      displayName,
      password: draft.password || undefined,
      role: draft.role,
    });
  };

  const handleCreate = async () => {
    const username = createForm.username.trim();
    const displayName = createForm.displayName.trim();
    const password = createForm.password;

    if (displayName.length < 2) {
      setCreateError("Display name must be at least 2 characters.");
      return;
    }

    if (username.length < 3) {
      setCreateError("Username must be at least 3 characters.");
      return;
    }

    if (password.length < 8) {
      setCreateError("Temporary password must be at least 8 characters.");
      return;
    }

    setCreateError(null);

    await onCreate({
      ...createForm,
      username,
      displayName,
    });

    setCreateForm({
      username: "",
      displayName: "",
      password: "",
      role: "member",
      colorHex: "#3B82F6",
    });
  };

  return (
    <section className="admin-panel">
      <div className="admin-panel__header">
        <div className="sidebar-section__label">Admin controls</div>
        <h2 className="admin-panel__title">User Management</h2>
        <p className="admin-panel__sub">
          Manage approved OpsUI users, ownership colors, and internal credentials.
        </p>
      </div>

      <div className="admin-grid">
        <section className="admin-add">
          <div className="admin-add__label">Add new user</div>

          <div className="admin-form">
            <label>
              Full name
              <input
                className="admin-input"
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    displayName: event.target.value,
                  }))
                }
                placeholder="Liam Barry"
                value={createForm.displayName}
              />
            </label>

            <label>
              Username
              <input
                className="admin-input"
                minLength={3}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    username: event.target.value,
                  }))
                }
                placeholder="liam"
                value={createForm.username}
              />
            </label>

            <label>
              Temporary password
              <input
                className="admin-input"
                minLength={8}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                placeholder="TempPass123"
                type="password"
                value={createForm.password}
              />
            </label>

            <div className="admin-inline-fields">
              <label>
                Role
                <SelectMenu
                  className="admin-select"
                  onChange={(nextValue) =>
                    setCreateForm((current) => ({
                      ...current,
                      role: nextValue as "admin" | "member",
                    }))
                  }
                  options={roleOptions}
                  value={createForm.role}
                />
              </label>

              <label>
                Color
                <input
                  className="admin-input admin-input--color"
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      colorHex: event.target.value,
                    }))
                  }
                  type="color"
                  value={createForm.colorHex}
                />
              </label>
            </div>

            {createError ? <div className="form-error">{createError}</div> : null}

            <button
              className="admin-add-btn"
              disabled={isBusy}
              onClick={() => void handleCreate()}
              type="button"
            >
              {isBusy ? "Working..." : "Add user"}
            </button>
          </div>
        </section>

        <section className="admin-table-shell">
          <div className="admin-table">
            <div className="admin-table__head">
              <span>User</span>
              <span>Role</span>
              <span>Status</span>
              <span>Color</span>
              <span>Password reset</span>
              <span>Actions</span>
            </div>

            {users.map((user) => {
              const draft = drafts[user.id] ?? {
                active: user.active,
                colorHex: user.colorHex,
                displayName: user.displayName,
                password: "",
                role: user.role,
              };
              const rowError = rowErrors[user.id];
              const isDirty = isUserDraftDirty(user, draft);

              return (
                <div
                  className={`admin-table__row ${draft?.active ? "" : "admin-table__row--inactive"}`}
                  key={user.id}
                >
                  <div className="admin-user-cell">
                    <div
                      className="avatar"
                      style={{
                        width: 36,
                        height: 36,
                        background: draft?.colorHex ?? user.colorHex,
                        fontSize: 13,
                      }}
                    >
                      {getInitials(draft?.displayName ?? user.displayName)}
                    </div>
                    <div className="admin-user-copy">
                      <input
                        className="admin-input"
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [user.id]: {
                              ...current[user.id],
                              displayName: event.target.value,
                            },
                          }))
                        }
                        value={draft?.displayName ?? user.displayName}
                      />
                      <div className="admin-user-email">{user.username}</div>
                    </div>
                  </div>

                  <div>
                    <SelectMenu
                      className="admin-select"
                      onChange={(nextValue) =>
                        setDrafts((current) => ({
                          ...current,
                          [user.id]: {
                            ...current[user.id],
                            role: nextValue as "admin" | "member",
                          },
                        }))
                      }
                      options={roleOptions}
                      value={draft?.role ?? user.role}
                    />
                  </div>

                  <div className="admin-status-cell">
                    <label className="admin-checkbox">
                      <input
                        checked={draft?.active ?? user.active}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [user.id]: {
                              ...current[user.id],
                              active: event.target.checked,
                            },
                          }))
                        }
                        type="checkbox"
                      />
                      <span
                        className={`status-badge ${(draft?.active ?? user.active) ? "status-confirmed" : "status-cancelled"}`}
                      >
                        {(draft?.active ?? user.active) ? "Active" : "Inactive"}
                      </span>
                    </label>
                  </div>

                  <div>
                    <input
                      className="admin-input admin-input--color"
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [user.id]: {
                            ...current[user.id],
                            colorHex: event.target.value,
                          },
                        }))
                      }
                      type="color"
                      value={draft?.colorHex ?? user.colorHex}
                    />
                  </div>

                  <div>
                    <input
                      className="admin-input"
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [user.id]: {
                            ...current[user.id],
                            password: event.target.value,
                          },
                        }))
                      }
                      placeholder="Optional"
                      type="password"
                      value={draft?.password ?? ""}
                    />
                  </div>

                  <div className="admin-actions">
                    <button
                      className={`admin-action-btn ${isDirty ? "admin-action-btn--save-ready" : "admin-action-btn--neutral"}`}
                      disabled={isBusy || !isDirty}
                      onClick={() => void handleSaveUser(user.id)}
                      type="button"
                    >
                      Save
                    </button>
                    <button
                      className="admin-action-btn admin-action-btn--danger"
                      disabled={isBusy || user.id === currentUserId}
                      onClick={() => {
                        if (window.confirm(`Remove ${user.displayName} from OpsUI Meetings?`)) {
                          void onDelete(user.id);
                        }
                      }}
                      type="button"
                    >
                      Remove
                    </button>
                    {rowError ? <div className="form-error">{rowError}</div> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </section>
  );
};

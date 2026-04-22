import { Fragment, useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createUser, deleteUser, listUsers, resetUserPassword, updateUserGroup, updateUserLoginName } from '../api';
import { useSession } from '../session';
import { USER_ROLES, type AdminUser, type UserRole } from '../types';

const roleLabel: Record<UserRole, string> = {
  admin: 'Administrator',
  member: 'Medlem',
  viewer: 'Kigger',
};

const statusLabel = (u: AdminUser): string => {
  if (!u.enabled) return 'Deaktiveret';
  if (u.status === 'CONFIRMED') return 'Aktiv';
  if (u.status === 'FORCE_CHANGE_PASSWORD') return 'Afventer første login';
  return u.status;
};

const primaryGroup = (groups: string[]): UserRole | '—' => {
  if (groups.includes('admin')) return 'admin';
  if (groups.includes('member')) return 'member';
  if (groups.includes('viewer')) return 'viewer';
  return '—';
};

export const AdminUsersPage = () => {
  const { session } = useSession();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingByUser, setPendingByUser] = useState<Record<string, string>>({});

  const [newEmail, setNewEmail] = useState('');
  const [newLoginName, setNewLoginName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('member');
  const [newPassword, setNewPassword] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteOk, setInviteOk] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  const [editingName, setEditingName] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');

  const [resetForUser, setResetForUser] = useState<string | null>(null);
  const [resetValue, setResetValue] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetOkFor, setResetOkFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const items = await listUsers(session.idToken);
      setUsers(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente brugere');
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const markPending = (username: string, msg: string) =>
    setPendingByUser((prev) => ({ ...prev, [username]: msg }));
  const clearPending = (username: string) =>
    setPendingByUser((prev) => {
      const next = { ...prev };
      delete next[username];
      return next;
    });

  const onChangeRole = async (user: AdminUser, nextRole: UserRole) => {
    if (!session) return;
    markPending(user.username, 'Opdaterer…');
    try {
      await updateUserGroup(session.idToken, user.username, nextRole);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke ændre rolle');
    } finally {
      clearPending(user.username);
    }
  };

  const onDelete = async (user: AdminUser) => {
    if (!session) return;
    if (!confirm(`Slet brugeren ${user.email}? Dette kan ikke fortrydes.`)) return;
    markPending(user.username, 'Sletter…');
    try {
      await deleteUser(session.idToken, user.username);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke slette brugeren');
    } finally {
      clearPending(user.username);
    }
  };

  const onInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setInviteError(null);
    setInviteOk(null);
    setInviting(true);
    try {
      await createUser(session.idToken, {
        email: newEmail.trim(),
        loginName: newLoginName.trim(),
        group: newRole,
        initialPassword: newPassword,
      });
      setInviteOk(`Bruger ${newEmail.trim()} oprettet.`);
      setNewEmail('');
      setNewLoginName('');
      setNewPassword('');
      setNewRole('member');
      await load();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Oprettelse mislykkedes');
    } finally {
      setInviting(false);
    }
  };

  const startEditName = (u: AdminUser) => {
    setEditingName(u.username);
    setEditingNameValue(u.loginName ?? '');
  };
  const cancelEditName = () => {
    setEditingName(null);
    setEditingNameValue('');
  };
  const saveEditName = async (u: AdminUser) => {
    if (!session) return;
    const next = editingNameValue.trim();
    if (!next || next === (u.loginName ?? '')) {
      cancelEditName();
      return;
    }
    markPending(u.username, 'Gemmer…');
    try {
      await updateUserLoginName(session.idToken, u.username, next);
      cancelEditName();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke ændre login-navn');
    } finally {
      clearPending(u.username);
    }
  };

  const openReset = (u: AdminUser) => {
    setResetForUser(u.username);
    setResetValue('');
    setResetError(null);
    setResetOkFor(null);
  };
  const cancelReset = () => {
    setResetForUser(null);
    setResetValue('');
    setResetError(null);
  };
  const saveReset = async (u: AdminUser) => {
    if (!session) return;
    setResetError(null);
    if (resetValue.length < 8) {
      setResetError('Adgangskoden skal være mindst 8 tegn.');
      return;
    }
    markPending(u.username, 'Nulstiller…');
    try {
      await resetUserPassword(session.idToken, u.username, resetValue);
      setResetForUser(null);
      setResetValue('');
      setResetOkFor(u.username);
    } catch (e) {
      setResetError(e instanceof Error ? e.message : 'Nulstilling mislykkedes');
    } finally {
      clearPending(u.username);
    }
  };

  return (
    <main className="content wide">
      <p className="eyebrow">Administration</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>Brugere</h1>
      <p className="lede">
        Administrer hvem der har adgang til Strandgaardens jubilæumsside. Roller: administrator (udvalget),
        medlem (uploader billeder), kigger (ser billeder via den delte login).
      </p>

      <section className="admin-invite">
        <h2>Invitér ny bruger</h2>
        <form onSubmit={onInvite} noValidate>
          <div className="field">
            <label htmlFor="new-email">E-mail</label>
            <input
              id="new-email"
              type="email"
              autoComplete="off"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="new-login-name">Login-navn</label>
            <input
              id="new-login-name"
              type="text"
              autoComplete="off"
              required
              minLength={2}
              maxLength={30}
              value={newLoginName}
              onChange={(e) => setNewLoginName(e.target.value)}
              placeholder="Vises i øverste højre hjørne i stedet for e-mail"
            />
            <div className="help">2–30 tegn. Bogstaver, tal, mellemrum, punktum, bindestreg eller understreg.</div>
          </div>
          <div className="field">
            <label htmlFor="new-role">Rolle</label>
            <select id="new-role" value={newRole} onChange={(e) => setNewRole(e.target.value as UserRole)}>
              {USER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="new-pw">Startadgangskode</label>
            <input
              id="new-pw"
              type="text"
              autoComplete="off"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mindst 8 tegn — brugeren kan selv ændre den senere"
            />
            <div className="help">
              Du giver denne startadgangskode videre til brugeren. Brugeren kan logge ind med det samme — der er
              ingen tvungen adgangskodeændring.
            </div>
          </div>
          {inviteError && <div className="error">{inviteError}</div>}
          {inviteOk && <div className="ok">{inviteOk}</div>}
          <button type="submit" disabled={inviting}>
            {inviting ? 'Opretter…' : 'Opret bruger'}
          </button>
        </form>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Eksisterende brugere</h2>
        {error && <div className="error">{error}</div>}
        {users === null && !error && <p>Indlæser…</p>}
        {users && users.length === 0 && <p>Ingen brugere endnu.</p>}
        {users && users.length > 0 && (
          <table className="user-table">
            <thead>
              <tr>
                <th>Login-navn</th>
                <th>E-mail</th>
                <th>Rolle</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const role = primaryGroup(u.groups);
                const pending = pendingByUser[u.username];
                const isEditing = editingName === u.username;
                const isResetting = resetForUser === u.username;
                const justReset = resetOkFor === u.username;
                return (
                  <Fragment key={u.username}>
                    <tr>
                      <td>
                        {isEditing ? (
                          <span style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center' }}>
                            <input
                              type="text"
                              value={editingNameValue}
                              maxLength={30}
                              autoFocus
                              onChange={(e) => setEditingNameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEditName(u);
                                if (e.key === 'Escape') cancelEditName();
                              }}
                              aria-label={`Login-navn for ${u.email}`}
                              style={{ width: '10rem' }}
                            />
                            <button type="button" onClick={() => saveEditName(u)} disabled={!!pending}>
                              Gem
                            </button>
                            <button type="button" onClick={cancelEditName} disabled={!!pending}>
                              Fortryd
                            </button>
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
                            <span>{u.loginName || <em className="subtle">(intet)</em>}</span>
                            <button type="button" onClick={() => startEditName(u)} disabled={!!pending}>
                              Rediger
                            </button>
                          </span>
                        )}
                      </td>
                      <td>{u.email}</td>
                      <td>
                        {role === '—' ? (
                          '—'
                        ) : (
                          <select
                            value={role}
                            disabled={!!pending}
                            onChange={(e) => onChangeRole(u, e.target.value as UserRole)}
                            aria-label={`Rolle for ${u.email}`}
                          >
                            {USER_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {roleLabel[r]}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>{statusLabel(u)}</td>
                      <td className="user-actions">
                        {pending ? (
                          <span className="subtle">{pending}</span>
                        ) : (
                          <span style={{ display: 'inline-flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            <button type="button" onClick={() => openReset(u)} disabled={isResetting}>
                              Nulstil adgangskode
                            </button>
                            <button className="danger" onClick={() => onDelete(u)}>
                              Slet
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                    {(isResetting || justReset) && (
                      <tr className="reset-row">
                        <td colSpan={5} style={{ background: 'var(--paper-warm)', padding: '1rem 1.25rem' }}>
                          {isResetting ? (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                saveReset(u);
                              }}
                              style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', flexWrap: 'wrap', margin: 0 }}
                            >
                              <div className="field" style={{ margin: 0, flex: '1 1 18rem', minWidth: '16rem' }}>
                                <label htmlFor={`reset-${u.username}`}>Ny adgangskode for {u.loginName || u.email}</label>
                                <input
                                  id={`reset-${u.username}`}
                                  type="text"
                                  autoComplete="new-password"
                                  autoFocus
                                  minLength={8}
                                  value={resetValue}
                                  onChange={(e) => setResetValue(e.target.value)}
                                  placeholder="Mindst 8 tegn — giv den videre til brugeren"
                                />
                                <div className="help">
                                  Brugeren kan logge ind med det samme. Der er ingen tvungen adgangskodeændring.
                                </div>
                              </div>
                              <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                                <button type="submit" className="primary">Gem</button>
                                <button type="button" onClick={cancelReset}>Fortryd</button>
                              </div>
                              {resetError && (
                                <div className="error" style={{ flex: '1 0 100%', margin: 0 }}>
                                  {resetError}
                                </div>
                              )}
                            </form>
                          ) : (
                            <div
                              className="ok"
                              style={{ margin: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}
                            >
                              <span>
                                Ny adgangskode gemt. Giv den videre til {u.loginName || u.email}.
                              </span>
                              <button type="button" onClick={() => setResetOkFor(null)}>
                                Luk
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
};

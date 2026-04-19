import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createUser, deleteUser, listUsers, updateUserGroup } from '../api';
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
  const [newRole, setNewRole] = useState<UserRole>('member');
  const [newPassword, setNewPassword] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteOk, setInviteOk] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

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
        group: newRole,
        initialPassword: newPassword,
      });
      setInviteOk(`Bruger ${newEmail.trim()} oprettet.`);
      setNewEmail('');
      setNewPassword('');
      setNewRole('member');
      await load();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Oprettelse mislykkedes');
    } finally {
      setInviting(false);
    }
  };

  return (
    <main className="content wide">
      <h1>Brugere</h1>
      <p className="subtle">
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
                return (
                  <tr key={u.username}>
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
                        <button className="danger" onClick={() => onDelete(u)}>
                          Slet
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
};

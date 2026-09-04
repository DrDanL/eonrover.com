'use client';

import { FormEvent, useCallback, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import StatusPanel from '@/components/StatusPanel';
import { apiGet, apiPost } from '@/lib/api';
import { formatDateTime } from '@/lib/formatters';
import { getErrorMessage, useApiData } from '@/lib/useApiData';
import { AdminUser } from '@/lib/web-types';

export default function AdminUsersPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadUsers = useCallback(() => apiGet<{ users: AdminUser[] }>(`/api/admin/users?q=${encodeURIComponent(search)}`), [search]);
  const { data, loading, error, reload } = useApiData(loadUsers);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(query);
  }

  async function updateStatus(userId: string, status: AdminUser['status']) {
    setBusyId(`${userId}-${status}`);
    setActionError(null);
    try {
      await apiPost(`/api/admin/users/${userId}/status`, { status });
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function renameUser(userId: string) {
    const username = renameDrafts[userId]?.trim();
    if (!username) {
      setActionError('Enter a new username before renaming.');
      return;
    }
    setBusyId(`${userId}-rename`);
    setActionError(null);
    try {
      await apiPost(`/api/admin/users/${userId}/rename`, { username });
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const canAdmin = user?.role === 'ADMIN';

  return (
    <section className="stack">
      <div className="panel stack"><h1 style={{ margin: 0 }}>Users</h1><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Search players and apply moderation actions.</p></div>
      <form className="panel stack" onSubmit={handleSearch}>
        <label>Search by username or email<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <button type="submit" className="btn btn-primary">Search</button>
      </form>
      {loading ? <StatusPanel message="Loading users..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load users" message={error} /> : null}
      {actionError ? <StatusPanel tone="error" title="User action failed" message={actionError} /> : null}
      {!loading && !error && data?.users.length === 0 ? <StatusPanel message="No users matched the current query." /> : null}
      {!loading && !error && data?.users.map((entry) => (
        <article className="panel stack" key={entry.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <strong>{entry.username}</strong>
              <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>{entry.email}</p>
            </div>
            <div className="stack" style={{ gap: '0.35rem', alignItems: 'flex-end' }}>
              <span className="tag">{entry.role}</span>
              <span className="tag">{entry.status}</span>
            </div>
          </div>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Created {formatDateTime(entry.createdAt)} · Last login {formatDateTime(entry.lastLoginAt ?? undefined)}</p>
          <div className="cta-row" style={{ justifyContent: 'flex-start' }}>
            <button type="button" onClick={() => updateStatus(entry.id, 'ACTIVE')} disabled={!canAdmin || busyId === `${entry.id}-ACTIVE`}>Restore</button>
            <button type="button" onClick={() => updateStatus(entry.id, 'SUSPENDED')} disabled={!canAdmin || busyId === `${entry.id}-SUSPENDED`}>Suspend</button>
            <button type="button" onClick={() => updateStatus(entry.id, 'BANNED')} disabled={!canAdmin || busyId === `${entry.id}-BANNED`}>Ban</button>
          </div>
          <div className="grid" style={{ gridTemplateColumns: '1fr auto' }}>
            <input value={renameDrafts[entry.id] ?? ''} onChange={(event) => setRenameDrafts((current) => ({ ...current, [entry.id]: event.target.value }))} placeholder="New username" disabled={!canAdmin} />
            <button type="button" onClick={() => renameUser(entry.id)} disabled={!canAdmin || busyId === `${entry.id}-rename`}>{busyId === `${entry.id}-rename` ? 'Renaming...' : 'Rename'}</button>
          </div>
          {!canAdmin ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Moderators can inspect users, but only admins can change status or rename accounts.</p> : null}
        </article>
      ))}
    </section>
  );
}

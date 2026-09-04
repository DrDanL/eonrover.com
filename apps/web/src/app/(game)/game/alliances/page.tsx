'use client';

import { FormEvent, useCallback, useState } from 'react';
import StatusPanel from '@/components/StatusPanel';
import { apiGet, apiPost } from '@/lib/api';
import { formatDateTime } from '@/lib/formatters';
import { getErrorMessage, useApiData } from '@/lib/useApiData';
import { Alliance, AllianceMembership } from '@/lib/web-types';

export default function AlliancesPage() {
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [description, setDescription] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadAlliances = useCallback(
    async () => Promise.all([
      apiGet<{ membership: AllianceMembership | null }>('/api/alliances/mine'),
      apiGet<{ alliances: Alliance[] }>('/api/alliances'),
    ]),
    [],
  );
  const { data, loading, error, reload } = useApiData(loadAlliances);
  const membership = data?.[0]?.membership ?? null;
  const alliances = data?.[1]?.alliances ?? [];

  async function createAlliance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyId('create');
    setActionError(null);
    try {
      await apiPost('/api/alliances', { name, tag, description: description || undefined });
      setName('');
      setTag('');
      setDescription('');
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function joinAlliance(allianceId: string) {
    setBusyId(allianceId);
    setActionError(null);
    try {
      await apiPost(`/api/alliances/${allianceId}/join`);
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function leaveAlliance() {
    setBusyId('leave');
    setActionError(null);
    try {
      await apiPost('/api/alliances/leave');
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="stack">
      <div className="panel stack"><h1 style={{ margin: 0 }}>Alliances</h1><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Join forces, compare member rosters, and build a public identity.</p></div>
      {loading ? <StatusPanel message="Loading alliance network..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load alliances" message={error} /> : null}
      {actionError ? <StatusPanel tone="error" title="Alliance action failed" message={actionError} /> : null}
      {!loading && !error && !data ? <StatusPanel message="No alliance data returned." /> : null}
      {!loading && !error && data ? (
        <>
          {membership ? (
            <div className="panel stack">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ margin: 0 }}>{membership.alliance.name} [{membership.alliance.tag}]</h2>
                  <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>{membership.alliance.description || 'No public description.'}</p>
                </div>
                <button type="button" onClick={leaveAlliance} disabled={busyId === 'leave'}>{busyId === 'leave' ? 'Leaving...' : 'Leave alliance'}</button>
              </div>
              <p style={{ margin: 0 }}>Your rank: {membership.rank}</p>
              <p style={{ margin: 0 }}>Joined: {formatDateTime(membership.joinedAt)}</p>
              <h3 style={{ marginBottom: 0 }}>Members</h3>
              {membership.alliance.members.map((member) => (
                <p key={member.id} style={{ margin: 0 }}>{member.user.username} · {member.rank}</p>
              ))}
            </div>
          ) : (
            <form className="panel stack" onSubmit={createAlliance}>
              <h2 style={{ margin: 0 }}>Create an alliance</h2>
              <label>Name<input value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={40} required /></label>
              <label>Tag<input value={tag} onChange={(event) => setTag(event.target.value.toUpperCase())} minLength={2} maxLength={6} required /></label>
              <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} maxLength={500} /></label>
              <button type="submit" className="btn btn-primary" disabled={busyId === 'create'}>{busyId === 'create' ? 'Creating...' : 'Create alliance'}</button>
            </form>
          )}
          <div className="panel stack">
            <h2 style={{ margin: 0 }}>Alliance directory</h2>
            {alliances.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No alliances have formed yet.</p> : null}
            {alliances.map((alliance) => (
              <div className="panel stack" key={alliance.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <strong>{alliance.name} [{alliance.tag}]</strong>
                  {!membership ? <button type="button" onClick={() => joinAlliance(alliance.id)} disabled={busyId === alliance.id}>{busyId === alliance.id ? 'Joining...' : 'Join'}</button> : null}
                </div>
                <span style={{ color: 'var(--color-text-muted)' }}>{alliance.description || 'No public description.'}</span>
                <span style={{ color: 'var(--color-text-muted)' }}>Members: {alliance.members.length}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

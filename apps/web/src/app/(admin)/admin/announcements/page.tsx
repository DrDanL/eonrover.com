'use client';

import { FormEvent, useCallback, useState } from 'react';
import StatusPanel from '@/components/StatusPanel';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { formatDateTime } from '@/lib/formatters';
import { getErrorMessage, useApiData } from '@/lib/useApiData';
import { Announcement } from '@/lib/web-types';

export default function AdminAnnouncementsPage() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const loadAnnouncements = useCallback(() => apiGet<{ announcements: Announcement[] }>('/api/admin/announcements'), []);
  const { data, loading, error, reload } = useApiData(loadAnnouncements);

  async function createAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyId('create');
    setActionError(null);
    try {
      await apiPost('/api/admin/announcements', { title, body });
      setTitle('');
      setBody('');
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteAnnouncement(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      await apiDelete(`/api/admin/announcements/${id}`);
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="stack">
      <div className="panel stack"><h1 style={{ margin: 0 }}>Announcements</h1><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Publish or remove updates shown on the public news page.</p></div>
      <form className="panel stack" onSubmit={createAnnouncement}>
        <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={150} required /></label>
        <label>Body<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={6} maxLength={5000} required /></label>
        <button type="submit" className="btn btn-primary" disabled={busyId === 'create'}>{busyId === 'create' ? 'Publishing...' : 'Publish announcement'}</button>
      </form>
      {loading ? <StatusPanel message="Loading announcements..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load announcements" message={error} /> : null}
      {actionError ? <StatusPanel tone="error" title="Announcement action failed" message={actionError} /> : null}
      {!loading && !error && data?.announcements.length === 0 ? <StatusPanel message="No announcements have been created." /> : null}
      {!loading && !error && data?.announcements.map((announcement) => (
        <article className="panel stack" key={announcement.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <strong>{announcement.title}</strong>
            <button type="button" onClick={() => deleteAnnouncement(announcement.id)} disabled={busyId === announcement.id}>{busyId === announcement.id ? 'Deleting...' : 'Delete'}</button>
          </div>
          <span style={{ color: 'var(--color-text-muted)' }}>{formatDateTime(announcement.createdAt)}</span>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{announcement.body}</p>
        </article>
      ))}
    </section>
  );
}

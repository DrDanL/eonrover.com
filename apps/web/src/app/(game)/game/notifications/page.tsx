'use client';

import { useCallback, useState } from 'react';
import StatusPanel from '@/components/StatusPanel';
import { apiGet, apiPost } from '@/lib/api';
import { enumLabel, formatDateTime } from '@/lib/formatters';
import { getErrorMessage, useApiData } from '@/lib/useApiData';
import { GameNotification } from '@/lib/web-types';

export default function NotificationsPage() {
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const loadNotifications = useCallback(() => apiGet<{ notifications: GameNotification[] }>('/api/notifications'), []);
  const { data, loading, error, reload } = useApiData(loadNotifications);

  async function markOne(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      await apiPost(`/api/notifications/${id}/read`);
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function markAll() {
    setBusyId('all');
    setActionError(null);
    try {
      await apiPost('/api/notifications/read-all');
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="stack">
      <div className="panel stack">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0 }}>Notifications</h1>
            <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Read operational alerts, report deliveries, and social events.</p>
          </div>
          <button type="button" onClick={markAll} disabled={busyId === 'all'}>{busyId === 'all' ? 'Marking...' : 'Mark all read'}</button>
        </div>
      </div>
      {loading ? <StatusPanel message="Loading notifications..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load notifications" message={error} /> : null}
      {actionError ? <StatusPanel tone="error" title="Notification action failed" message={actionError} /> : null}
      {!loading && !error && data?.notifications.length === 0 ? <StatusPanel message="No notifications right now." /> : null}
      {!loading && !error && data?.notifications.map((notification) => (
        <article className="panel stack" key={notification.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <strong>{enumLabel(notification.type)}</strong>
            <span className="tag">{notification.readAt ? 'Read' : 'Unread'}</span>
          </div>
          <p style={{ margin: 0 }}>{notification.message}</p>
          <span style={{ color: 'var(--color-text-muted)' }}>{formatDateTime(notification.createdAt)}</span>
          {!notification.readAt ? <button type="button" onClick={() => markOne(notification.id)} disabled={busyId === notification.id}>{busyId === notification.id ? 'Marking...' : 'Mark read'}</button> : null}
        </article>
      ))}
    </section>
  );
}

'use client';

import { useCallback } from 'react';
import StatusPanel from '@/components/StatusPanel';
import { apiGet } from '@/lib/api';
import { formatDateTime } from '@/lib/formatters';
import { useApiData } from '@/lib/useApiData';
import { SecurityEvent } from '@/lib/web-types';

export default function AdminSecurityPage() {
  const loadSecurity = useCallback(() => apiGet<{ events: SecurityEvent[] }>('/api/admin/security-events'), []);
  const { data, loading, error } = useApiData(loadSecurity);

  return (
    <section className="stack">
      <div className="panel stack"><h1 style={{ margin: 0 }}>Security Events</h1><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Review recent failed logins and other recorded security signals.</p></div>
      {loading ? <StatusPanel message="Loading security events..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load security events" message={error} /> : null}
      {!loading && !error && data?.events.length === 0 ? <StatusPanel message="No security events recorded." /> : null}
      {!loading && !error && data?.events.map((event) => (
        <article className="panel stack" key={event.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <strong>{event.type}</strong>
            <span className="tag">{formatDateTime(event.createdAt)}</span>
          </div>
          <p style={{ margin: 0 }}>IP: {event.ipAddress ?? 'Unknown'}</p>
          <pre className="json-block">{JSON.stringify(event.metadata ?? {}, null, 2)}</pre>
        </article>
      ))}
    </section>
  );
}

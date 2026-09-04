'use client';

import { useCallback } from 'react';
import StatusPanel from '@/components/StatusPanel';
import { apiGet } from '@/lib/api';
import { formatDateTime } from '@/lib/formatters';
import { useApiData } from '@/lib/useApiData';
import { AuditLog } from '@/lib/web-types';

export default function AdminAuditPage() {
  const loadAudit = useCallback(() => apiGet<{ logs: AuditLog[] }>('/api/admin/audit-log'), []);
  const { data, loading, error } = useApiData(loadAudit);

  return (
    <section className="stack">
      <div className="panel stack"><h1 style={{ margin: 0 }}>Audit Log</h1><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>A rolling history of administrative actions recorded by the API.</p></div>
      {loading ? <StatusPanel message="Loading audit log..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load audit log" message={error} /> : null}
      {!loading && !error && data?.logs.length === 0 ? <StatusPanel message="No audit entries found." /> : null}
      {!loading && !error && data?.logs.map((entry) => (
        <article className="panel stack" key={entry.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <strong>{entry.action}</strong>
            <span className="tag">{formatDateTime(entry.createdAt)}</span>
          </div>
          <p style={{ margin: 0 }}>Actor: {entry.actor.username}</p>
          <p style={{ margin: 0 }}>Target: {entry.targetType ?? '—'} {entry.targetId ?? ''}</p>
          <pre className="json-block">{JSON.stringify(entry.metadata ?? {}, null, 2)}</pre>
        </article>
      ))}
    </section>
  );
}

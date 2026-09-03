'use client';

import { useCallback } from 'react';
import StatusPanel from '@/components/StatusPanel';
import { apiGet } from '@/lib/api';
import { formatDateTime, formatNumber } from '@/lib/formatters';
import { useApiData } from '@/lib/useApiData';
import { AdminDashboardData } from '@/lib/web-types';

export default function AdminDashboardPage() {
  const loadDashboard = useCallback(
    async () => Promise.all([
      apiGet<AdminDashboardData>('/api/admin/dashboard'),
      apiGet<{ database: boolean; redis: boolean; timestamp: string }>('/api/admin/health'),
    ]),
    [],
  );
  const { data, loading, error } = useApiData(loadDashboard);
  const dashboard = data?.[0];
  const health = data?.[1];

  return (
    <section className="stack">
      <div className="panel stack"><h1 style={{ margin: 0 }}>Admin Dashboard</h1><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Monitor player counts, queues, and infrastructure health.</p></div>
      {loading ? <StatusPanel message="Loading dashboard..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load admin dashboard" message={error} /> : null}
      {!loading && !error && (!dashboard || !health) ? <StatusPanel message="No admin summary returned." /> : null}
      {!loading && !error && dashboard && health ? (
        <>
          <div className="grid grid-cards">
            <div className="panel stack"><h2 style={{ margin: 0 }}>{formatNumber(dashboard.userCount)}</h2><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Users</p></div>
            <div className="panel stack"><h2 style={{ margin: 0 }}>{formatNumber(dashboard.activeUsers)}</h2><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Active accounts</p></div>
            <div className="panel stack"><h2 style={{ margin: 0 }}>{formatNumber(dashboard.planetCount)}</h2><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Planets</p></div>
            <div className="panel stack"><h2 style={{ margin: 0 }}>{formatNumber(dashboard.fleetsInFlight)}</h2><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Fleets in flight</p></div>
            <div className="panel stack"><h2 style={{ margin: 0 }}>{formatNumber(dashboard.alliances)}</h2><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Alliances</p></div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <div className="panel stack">
              <h2 style={{ margin: 0 }}>System health</h2>
              <p style={{ margin: 0 }}>Database: {health.database ? 'Online' : 'Offline'}</p>
              <p style={{ margin: 0 }}>Redis: {health.redis ? 'Online' : 'Offline'}</p>
              <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Updated {formatDateTime(health.timestamp)}</p>
            </div>
            <div className="panel stack">
              <h2 style={{ margin: 0 }}>Queue depth</h2>
              {dashboard.queues.map((queue) => <p key={queue.name} style={{ margin: 0 }}>{queue.name}: waiting {queue.waiting}, delayed {queue.delayed}, active {queue.active}, failed {queue.failed}</p>)}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

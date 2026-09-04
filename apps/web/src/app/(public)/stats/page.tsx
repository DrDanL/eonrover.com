'use client';

import { useCallback } from 'react';
import StatusPanel from '@/components/StatusPanel';
import { apiGet } from '@/lib/api';
import { formatNumber } from '@/lib/formatters';
import { useApiData } from '@/lib/useApiData';
import { UniverseStats } from '@/lib/web-types';

export default function StatsPage() {
  const loadStats = useCallback(() => apiGet<UniverseStats>('/api/public/stats'), []);
  const { data, loading, error } = useApiData(loadStats);

  return (
    <section className="stack" style={{ padding: '2rem 0 4rem' }}>
      <div className="panel stack">
        <h1 style={{ margin: 0 }}>Universe Statistics</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>A live snapshot of activity across the Eon Reach.</p>
      </div>
      {loading ? <StatusPanel message="Loading universe telemetry..." /> : null}
      {error ? <StatusPanel tone="error" title="Telemetry unavailable" message={error} /> : null}
      {!loading && !error && data ? (
        <div className="grid grid-cards">
          <div className="panel stack"><h2 style={{ margin: 0 }}>{formatNumber(data.playerCount)}</h2><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Active commanders</p></div>
          <div className="panel stack"><h2 style={{ margin: 0 }}>{formatNumber(data.planetCount)}</h2><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Settled worlds</p></div>
          <div className="panel stack"><h2 style={{ margin: 0 }}>{formatNumber(data.allianceCount)}</h2><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Registered alliances</p></div>
        </div>
      ) : null}
      {!loading && !error && !data ? <StatusPanel message="No public stats are available right now." /> : null}
    </section>
  );
}

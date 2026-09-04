'use client';

import { useCallback, useState } from 'react';
import { useParams } from 'next/navigation';
import StatusPanel from '@/components/StatusPanel';
import { apiGet, apiPost } from '@/lib/api';
import { enumLabel, formatNumber, formatRelativeCountdown } from '@/lib/formatters';
import { getErrorMessage, useApiData, useTicker } from '@/lib/useApiData';
import { ResearchCatalogItem, ResearchQueueItem } from '@/lib/web-types';

export default function ResearchPage() {
  const params = useParams<{ planetId: string }>();
  const planetId = params.planetId;
  const now = useTicker();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadResearch = useCallback(() => apiGet<{ catalog: ResearchCatalogItem[]; queue: ResearchQueueItem[] }>('/api/research'), []);
  const { data, loading, error, reload } = useApiData(loadResearch);

  async function startResearch(key: string) {
    setBusyKey(key);
    setActionError(null);
    try {
      await apiPost('/api/research', { key, planetId });
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="stack">
      <div className="panel stack"><h1 style={{ margin: 0 }}>Research</h1><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Research is empire-wide, but you must fund it from the current colony.</p></div>
      {loading ? <StatusPanel message="Loading research tree..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load research" message={error} /> : null}
      {actionError ? <StatusPanel tone="error" title="Research action failed" message={actionError} /> : null}
      {!loading && !error && !data ? <StatusPanel message="No research data returned." /> : null}
      {!loading && !error && data ? (
        <>
          <div className="panel stack">
            <h2 style={{ margin: 0 }}>Active research queue</h2>
            {data.queue.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No research currently in progress.</p> : null}
            {data.queue.map((item) => (
              <div className="panel stack" key={item.id}>
                <strong>{enumLabel(item.researchKey)} → level {item.targetLevel}</strong>
                <span style={{ color: 'var(--color-text-muted)' }}>Completes in {formatRelativeCountdown(item.completesAt, now)}</span>
              </div>
            ))}
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            {data.catalog.map((research) => (
              <article className="panel stack" key={research.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'baseline' }}>
                  <h2 style={{ margin: 0 }}>{research.name}</h2>
                  <span className="tag">Level {research.level}</span>
                </div>
                <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>{research.description}</p>
                <p style={{ margin: 0 }}>Next cost: {formatNumber(research.nextCost.alloy)} alloy, {formatNumber(research.nextCost.heliox)} heliox, {formatNumber(research.nextCost.aether)} aether</p>
                {research.requires && Object.keys(research.requires).length > 0 ? (
                  <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
                    Requires: {Object.entries(research.requires).map(([key, level]) => `${enumLabel(key)} ${level}`).join(', ')}
                  </p>
                ) : null}
                <button type="button" className="btn btn-primary" onClick={() => startResearch(research.key)} disabled={busyKey === research.key}>
                  {busyKey === research.key ? 'Starting...' : 'Start research'}
                </button>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

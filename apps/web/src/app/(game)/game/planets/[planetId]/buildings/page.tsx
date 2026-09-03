'use client';

import { useCallback, useState } from 'react';
import { useParams } from 'next/navigation';
import StatusPanel from '@/components/StatusPanel';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { enumLabel, formatNumber, formatRelativeCountdown } from '@/lib/formatters';
import { getErrorMessage, useApiData, useTicker } from '@/lib/useApiData';
import { BuildingCatalogItem, BuildQueueItem } from '@/lib/web-types';

export default function BuildingsPage() {
  const params = useParams<{ planetId: string }>();
  const planetId = params.planetId;
  const now = useTicker();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadBuildings = useCallback(
    () => apiGet<{ catalog: BuildingCatalogItem[]; queue: BuildQueueItem[] }>(`/api/planets/${planetId}/buildings`),
    [planetId],
  );
  const { data, loading, error, reload } = useApiData(loadBuildings);

  async function enqueue(key: string) {
    setBusyKey(key);
    setActionError(null);
    try {
      await apiPost(`/api/planets/${planetId}/buildings`, { key });
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function cancelQueue(queueItemId: string) {
    setBusyKey(queueItemId);
    setActionError(null);
    try {
      await apiDelete(`/api/planets/${planetId}/buildings/${queueItemId}`);
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="stack">
      <div className="panel stack"><h1 style={{ margin: 0 }}>Buildings</h1><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Queue upgrades and monitor their completion windows.</p></div>
      {loading ? <StatusPanel message="Loading building catalog..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load buildings" message={error} /> : null}
      {actionError ? <StatusPanel tone="error" title="Build action failed" message={actionError} /> : null}
      {!loading && !error && !data ? <StatusPanel message="No building data returned." /> : null}
      {!loading && !error && data ? (
        <>
          <div className="panel stack">
            <h2 style={{ margin: 0 }}>Current queue</h2>
            {data.queue.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No building upgrades queued.</p> : null}
            {data.queue.map((item) => (
              <div key={item.id} className="panel stack">
                <strong>{enumLabel(item.buildingKey)} → level {item.targetLevel}</strong>
                <span style={{ color: 'var(--color-text-muted)' }}>Completes in {formatRelativeCountdown(item.completesAt, now)}</span>
                <button type="button" onClick={() => cancelQueue(item.id)} disabled={busyKey === item.id}>Cancel</button>
              </div>
            ))}
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            {data.catalog.map((building) => (
              <article className="panel stack" key={building.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'baseline' }}>
                  <h2 style={{ margin: 0 }}>{building.name}</h2>
                  <span className="tag">Level {building.level}</span>
                </div>
                <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>{building.description}</p>
                <p style={{ margin: 0 }}>Next cost: {formatNumber(building.nextCost.alloy)} alloy, {formatNumber(building.nextCost.heliox)} heliox, {formatNumber(building.nextCost.aether)} aether</p>
                <p style={{ margin: 0 }}>Energy: {building.baseEnergy < 0 ? 'Produces' : 'Consumes'} {formatNumber(Math.abs(building.baseEnergy))}</p>
                {building.requires && Object.keys(building.requires).length > 0 ? (
                  <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
                    Requires: {Object.entries(building.requires).map(([key, level]) => `${enumLabel(key)} ${level}`).join(', ')}
                  </p>
                ) : null}
                <button type="button" className="btn btn-primary" onClick={() => enqueue(building.key)} disabled={busyKey === building.key}>
                  {busyKey === building.key ? 'Queueing...' : 'Queue upgrade'}
                </button>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

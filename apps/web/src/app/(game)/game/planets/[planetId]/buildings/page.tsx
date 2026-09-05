'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import ResourceBar from '@/components/ResourceBar';
import StatusPanel from '@/components/StatusPanel';
import { ApiError, apiDelete, apiGet, apiPost } from '@/lib/api';
import { enumLabel, formatNumber, formatRelativeCountdown } from '@/lib/formatters';
import { getErrorMessage, useApiData, useTicker } from '@/lib/useApiData';
import { BuildingCatalogItem, BuildQueueItem, PlanetSummary, ResourceAmounts } from '@/lib/web-types';

interface BuildingsResponse {
  catalog: BuildingCatalogItem[];
  queue: BuildQueueItem[];
  planet: PlanetSummary;
  storage: ResourceAmounts;
  production: ResourceAmounts;
}

export default function BuildingsPage() {
  const params = useParams<{ planetId: string }>();
  const planetId = params.planetId;
  const now = useTicker();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const refreshedDueConstruction = useRef<string | null>(null);

  const loadBuildings = useCallback(
    () => apiGet<BuildingsResponse>(`/api/planets/${planetId}/buildings`),
    [planetId],
  );
  const { data, loading, error, reload } = useApiData(loadBuildings);
  const hasActiveConstruction = (data?.queue.length ?? 0) > 0;
  const actionPending = busyKey !== null;
  const dueConstruction = data?.queue.find((item) => new Date(item.completesAt).getTime() <= now);

  useEffect(() => {
    if (!dueConstruction) {
      refreshedDueConstruction.current = null;
      return;
    }
    if (refreshedDueConstruction.current === dueConstruction.id) return;
    refreshedDueConstruction.current = dueConstruction.id;
    reload();
  }, [dueConstruction, reload]);

  async function enqueue(key: string) {
    setBusyKey(key);
    setActionError(null);
    try {
      await apiPost(`/api/planets/${planetId}/buildings`, { key });
      reload();
    } catch (err) {
      setActionError(
        err instanceof ApiError && err.code === 'CONSTRUCTION_IN_PROGRESS'
          ? 'A building upgrade is already in progress on this planet.'
          : getErrorMessage(err),
      );
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
          <ResourceBar resources={data.planet} storage={data.storage} production={data.production} />
          <div className="panel stack">
            <h2 style={{ margin: 0 }}>Current queue</h2>
            {data.queue.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No building upgrades queued.</p> : null}
            {data.queue.map((item) => (
              <div key={item.id} className="panel stack">
                <strong>{enumLabel(item.buildingKey)} → level {item.targetLevel}</strong>
                <span style={{ color: 'var(--color-text-muted)' }}>Completes in {formatRelativeCountdown(item.completesAt, now)}</span>
                <button type="button" onClick={() => cancelQueue(item.id)} disabled={actionPending}>
                  {busyKey === item.id ? 'Cancelling...' : 'Cancel'}
                </button>
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
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => enqueue(building.key)}
                  disabled={actionPending || hasActiveConstruction}
                >
                  {busyKey === building.key
                    ? 'Queueing...'
                    : hasActiveConstruction
                      ? 'Construction in progress'
                      : 'Queue upgrade'}
                </button>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

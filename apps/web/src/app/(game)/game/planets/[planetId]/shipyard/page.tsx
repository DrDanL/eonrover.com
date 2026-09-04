'use client';

import { FormEvent, useCallback, useState } from 'react';
import { useParams } from 'next/navigation';
import StatusPanel from '@/components/StatusPanel';
import { apiGet, apiPost } from '@/lib/api';
import { enumLabel, formatNumber, formatRelativeCountdown } from '@/lib/formatters';
import { getErrorMessage, useApiData, useTicker } from '@/lib/useApiData';
import { ShipyardCatalogItem, ShipyardQueueItem } from '@/lib/web-types';

export default function ShipyardPage() {
  const params = useParams<{ planetId: string }>();
  const planetId = params.planetId;
  const now = useTicker();
  const [actionError, setActionError] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadShipyard = useCallback(
    () => apiGet<{ ships: ShipyardCatalogItem[]; defences: ShipyardCatalogItem[]; queue: ShipyardQueueItem[] }>(`/api/planets/${planetId}/shipyard`),
    [planetId],
  );
  const { data, loading, error, reload } = useApiData(loadShipyard);

  async function handleQueue(event: FormEvent<HTMLFormElement>, itemKey: string, itemType: 'ship' | 'defence') {
    event.preventDefault();
    const quantity = Number(quantities[itemKey] ?? 0);
    if (!Number.isInteger(quantity) || quantity < 1) {
      setActionError('Enter a quantity of at least 1.');
      return;
    }
    setBusyKey(itemKey);
    setActionError(null);
    try {
      await apiPost(`/api/planets/${planetId}/shipyard`, { itemKey, itemType, quantity });
      setQuantities((current) => ({ ...current, [itemKey]: '' }));
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  const sections = [
    { title: 'Ships', items: data?.ships ?? [], itemType: 'ship' as const },
    { title: 'Defences', items: data?.defences ?? [], itemType: 'defence' as const },
  ];

  return (
    <section className="stack">
      <div className="panel stack"><h1 style={{ margin: 0 }}>Shipyard</h1><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Build ships and planetary defences from the same queue system.</p></div>
      {loading ? <StatusPanel message="Loading shipyard catalog..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load shipyard" message={error} /> : null}
      {actionError ? <StatusPanel tone="error" title="Queue action failed" message={actionError} /> : null}
      {!loading && !error && !data ? <StatusPanel message="No shipyard data returned." /> : null}
      {!loading && !error && data ? (
        <>
          <div className="panel stack">
            <h2 style={{ margin: 0 }}>Current queue</h2>
            {data.queue.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No shipyard jobs queued.</p> : null}
            {data.queue.map((item) => (
              <div className="panel stack" key={item.id}>
                <strong>{enumLabel(item.itemKey)} × {formatNumber(item.quantity)}</strong>
                <span style={{ color: 'var(--color-text-muted)' }}>Remaining: {formatNumber(item.remaining)} · completes in {formatRelativeCountdown(item.completesAt, now)}</span>
              </div>
            ))}
          </div>
          {sections.map((section) => (
            <div className="stack" key={section.title}>
              <h2 style={{ marginBottom: 0 }}>{section.title}</h2>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                {section.items.map((item) => (
                  <article className="panel stack" key={item.key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                      <h3 style={{ margin: 0 }}>{item.name}</h3>
                      <span className="tag">Owned {formatNumber(item.owned)}</span>
                    </div>
                    {item.description ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>{item.description}</p> : null}
                    <p style={{ margin: 0 }}>Cost: {formatNumber(item.cost.alloy)} alloy, {formatNumber(item.cost.heliox)} heliox, {formatNumber(item.cost.aether)} aether</p>
                    {item.speed ? <p style={{ margin: 0 }}>Speed: {formatNumber(item.speed)} · Cargo: {formatNumber(item.cargo ?? 0)}</p> : null}
                    {item.attack !== undefined ? <p style={{ margin: 0 }}>Attack {formatNumber(item.attack)} · Shield {formatNumber(item.shield ?? 0)} · Armour {formatNumber(item.armour ?? 0)}</p> : null}
                    {item.requires && Object.keys(item.requires).length > 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Requires: {Object.entries(item.requires).map(([key, level]) => `${enumLabel(key)} ${level}`).join(', ')}</p> : null}
                    <form className="stack" onSubmit={(event) => handleQueue(event, item.key, section.itemType)}>
                      <label>
                        Quantity
                        <input type="number" min={1} max={500} value={quantities[item.key] ?? ''} onChange={(event) => setQuantities((current) => ({ ...current, [item.key]: event.target.value }))} />
                      </label>
                      <button type="submit" className="btn btn-primary" disabled={busyKey === item.key}>{busyKey === item.key ? 'Queueing...' : 'Add to queue'}</button>
                    </form>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </>
      ) : null}
    </section>
  );
}

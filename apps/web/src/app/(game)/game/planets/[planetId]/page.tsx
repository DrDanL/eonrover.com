'use client';

import { FormEvent, useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import ResourceBar from '@/components/ResourceBar';
import StatusPanel from '@/components/StatusPanel';
import { apiGet, apiPatch } from '@/lib/api';
import { enumLabel, formatCoords, formatDateTime, formatNumber } from '@/lib/formatters';
import { getErrorMessage, useApiData } from '@/lib/useApiData';
import { PlanetFullState } from '@/lib/web-types';

export default function PlanetOverviewPage() {
  const params = useParams<{ planetId: string }>();
  const planetId = params.planetId;
  const [name, setName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadPlanet = useCallback(() => apiGet<PlanetFullState>(`/api/planets/${planetId}`), [planetId]);
  const { data, loading, error, reload } = useApiData(loadPlanet);

  const buildingMap = useMemo(
    () => Object.fromEntries((data?.buildings ?? []).map((building) => [building.key, building.level])),
    [data?.buildings],
  );

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      const response = await apiPatch<{ planet: { name: string } }>(`/api/planets/${planetId}`, { name });
      setName(response.planet.name);
      setSaveMessage('Planet name updated.');
      reload();
    } catch (err) {
      setSaveError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="stack">
      {loading ? <StatusPanel message="Loading planetary telemetry..." /> : null}
      {error ? <StatusPanel tone="error" title="Planet unavailable" message={error} /> : null}
      {!loading && !error && !data ? <StatusPanel message="No planet data found." /> : null}
      {!loading && !error && data ? (
        <>
          <div className="panel stack">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <h1 style={{ margin: 0 }}>{data.planet.name}</h1>
                <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
                  {formatCoords(data.planet)} · {enumLabel(data.planet.planetType)} · solar index {data.planet.solarIndex.toFixed(2)}
                </p>
              </div>
              {data.planet.isHomeworld ? <span className="tag">Homeworld</span> : null}
            </div>
          </div>
          <ResourceBar resources={data.planet} storage={data.storage} />
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <div className="panel stack">
              <h2 style={{ margin: 0 }}>Energy</h2>
              <p style={{ margin: 0 }}>Supply: {formatNumber(data.energy.supply)}</p>
              <p style={{ margin: 0 }}>Consumption: {formatNumber(data.energy.consumption)}</p>
              <p style={{ margin: 0 }}>Efficiency: {Math.round(data.energy.efficiency * 100)}%</p>
            </div>
            <div className="panel stack">
              <h2 style={{ margin: 0 }}>Infrastructure</h2>
              <p style={{ margin: 0 }}>Alloy Mine: {formatNumber(buildingMap.alloyMine ?? 0)}</p>
              <p style={{ margin: 0 }}>Heliox Extractor: {formatNumber(buildingMap.helioxExtractor ?? 0)}</p>
              <p style={{ margin: 0 }}>Aether Synthesizer: {formatNumber(buildingMap.aetherSynthesizer ?? 0)}</p>
              <p style={{ margin: 0 }}>Research Lab: {formatNumber(buildingMap.researchLab ?? 0)}</p>
            </div>
            <div className="panel stack">
              <h2 style={{ margin: 0 }}>Queues</h2>
              <p style={{ margin: 0 }}>Buildings queued: {data.buildQueue.length}</p>
              <p style={{ margin: 0 }}>Research queued: {data.researchQueue.length}</p>
              <p style={{ margin: 0 }}>Shipyard queued: {data.shipyardQueue.length}</p>
            </div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            <div className="panel stack">
              <h2 style={{ margin: 0 }}>Rename colony</h2>
              {saveError ? <div className="alert alert-error">{saveError}</div> : null}
              {saveMessage ? <div className="alert alert-success">{saveMessage}</div> : null}
              <form className="stack" onSubmit={handleRename}>
                <label>
                  Planet name
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={data.planet.name}
                    maxLength={40}
                    required
                  />
                </label>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save name'}</button>
              </form>
            </div>
            <div className="panel stack">
              <h2 style={{ margin: 0 }}>Current garrison</h2>
              {data.ships.length === 0 && data.defences.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No ships or defences stationed here.</p> : null}
              {data.ships.map((ship) => <p key={ship.id} style={{ margin: 0 }}>{enumLabel(ship.key)}: {formatNumber(ship.count)}</p>)}
              {data.defences.map((defence) => <p key={defence.id} style={{ margin: 0 }}>{enumLabel(defence.key)}: {formatNumber(defence.count)}</p>)}
            </div>
          </div>
          <div className="panel stack">
            <h2 style={{ margin: 0 }}>Queue snapshot</h2>
            {data.buildQueue.length === 0 && data.researchQueue.length === 0 && data.shipyardQueue.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No active queues on this colony.</p>
            ) : (
              <>
                {data.buildQueue.map((item) => <p key={item.id} style={{ margin: 0 }}>Building: {enumLabel(item.buildingKey)} to level {item.targetLevel} · completes {formatDateTime(item.completesAt)}</p>)}
                {data.researchQueue.map((item) => <p key={item.id} style={{ margin: 0 }}>Research: {enumLabel(item.researchKey)} to level {item.targetLevel} · completes {formatDateTime(item.completesAt)}</p>)}
                {data.shipyardQueue.map((item) => <p key={item.id} style={{ margin: 0 }}>Shipyard: {enumLabel(item.itemKey)} × {item.quantity} · completes {formatDateTime(item.completesAt)}</p>)}
              </>
            )}
          </div>
          <div className="panel stack">
            <h2 style={{ margin: 0 }}>Linked actions</h2>
            <div className="cta-row" style={{ justifyContent: 'flex-start' }}>
              <Link href={`/game/planets/${planetId}/buildings`} className="btn">Buildings</Link>
              <Link href={`/game/planets/${planetId}/research`} className="btn">Research</Link>
              <Link href={`/game/planets/${planetId}/shipyard`} className="btn">Shipyard</Link>
              <Link href={`/game/planets/${planetId}/fleet`} className="btn">Fleet</Link>
            </div>
            <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
              Production rates are not exposed in the current planet API response, so this overview focuses on stored resources, energy, and active queues.
            </p>
          </div>
        </>
      ) : null}
    </section>
  );
}

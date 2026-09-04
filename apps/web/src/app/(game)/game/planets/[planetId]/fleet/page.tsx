'use client';

import { FormEvent, useCallback, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import StatusPanel from '@/components/StatusPanel';
import { apiGet, apiPost } from '@/lib/api';
import { enumLabel, formatCoords, formatDateTime, formatNumber } from '@/lib/formatters';
import { getErrorMessage, useApiData } from '@/lib/useApiData';
import { FleetMission, PlanetSummary, ShipyardCatalogItem } from '@/lib/web-types';

const MISSIONS = ['TRANSPORT', 'DEPLOY', 'ESPIONAGE', 'ATTACK', 'RAID', 'RECYCLE', 'COLONIZE', 'EXPLORE', 'GATE_TRAVEL'] as const;

export default function FleetPage() {
  const params = useParams<{ planetId: string }>();
  const planetId = params.planetId;
  const [missionType, setMissionType] = useState<(typeof MISSIONS)[number]>('TRANSPORT');
  const [targetGalaxy, setTargetGalaxy] = useState('1');
  const [targetSystem, setTargetSystem] = useState('1');
  const [targetSlot, setTargetSlot] = useState('1');
  const [speedPercent, setSpeedPercent] = useState('100');
  const [cargoAlloy, setCargoAlloy] = useState('0');
  const [cargoHeliox, setCargoHeliox] = useState('0');
  const [cargoAether, setCargoAether] = useState('0');
  const [shipCounts, setShipCounts] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recallingId, setRecallingId] = useState<string | null>(null);

  const loadFleetData = useCallback(
    async () => Promise.all([
      apiGet<{ missions: FleetMission[] }>('/api/fleet'),
      apiGet<{ ships: ShipyardCatalogItem[] }>(`/api/planets/${planetId}/shipyard`),
      apiGet<{ planets: PlanetSummary[] }>('/api/planets'),
    ]),
    [planetId],
  );
  const { data, loading, error, reload } = useApiData(loadFleetData);

  const missions = data?.[0]?.missions ?? [];
  const availableShips = (data?.[1]?.ships ?? []).filter((ship) => ship.owned > 0);
  const currentPlanet = data?.[2]?.planets.find((planet) => planet.id === planetId);

  const shipPayload = useMemo<Record<string, number>>(() => {
    const entries: Array<[string, number]> = [];
    for (const ship of availableShips) {
      const count = Number(shipCounts[ship.key] ?? 0);
      if (Number.isFinite(count) && count > 0) {
        entries.push([ship.key, count]);
      }
    }
    return Object.fromEntries(entries);
  }, [availableShips, shipCounts]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setActionError(null);
    try {
      await apiPost('/api/fleet', {
        originId: planetId,
        targetGalaxy: Number(targetGalaxy),
        targetSystem: Number(targetSystem),
        targetSlot: Number(targetSlot),
        missionType,
        ships: shipPayload,
        cargo: {
          alloy: Number(cargoAlloy),
          heliox: Number(cargoHeliox),
          aether: Number(cargoAether),
        },
        speedPercent: Number(speedPercent),
      });
      setShipCounts({});
      setCargoAlloy('0');
      setCargoHeliox('0');
      setCargoAether('0');
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function recallMission(missionId: string) {
    setRecallingId(missionId);
    setActionError(null);
    try {
      await apiPost(`/api/fleet/${missionId}/recall`);
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setRecallingId(null);
    }
  }

  return (
    <section className="stack">
      <div className="panel stack">
        <h1 style={{ margin: 0 }}>Fleet Command</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
          Dispatch from {currentPlanet ? `${currentPlanet.name} ${formatCoords(currentPlanet)}` : 'this colony'}.
        </p>
      </div>
      {loading ? <StatusPanel message="Loading fleet data..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load fleet command" message={error} /> : null}
      {actionError ? <StatusPanel tone="error" title="Fleet action failed" message={actionError} /> : null}
      {!loading && !error && !data ? <StatusPanel message="Fleet data is unavailable." /> : null}
      {!loading && !error && data ? (
        <>
          <form className="panel stack" onSubmit={handleSubmit}>
            <h2 style={{ margin: 0 }}>Send mission</h2>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <label>Mission type<select value={missionType} onChange={(event) => setMissionType(event.target.value as (typeof MISSIONS)[number])}>{MISSIONS.map((mission) => <option key={mission} value={mission}>{enumLabel(mission)}</option>)}</select></label>
              <label>Galaxy<input type="number" min={1} value={targetGalaxy} onChange={(event) => setTargetGalaxy(event.target.value)} required /></label>
              <label>System<input type="number" min={1} value={targetSystem} onChange={(event) => setTargetSystem(event.target.value)} required /></label>
              <label>Slot<input type="number" min={1} value={targetSlot} onChange={(event) => setTargetSlot(event.target.value)} required /></label>
              <label>Speed %<input type="number" min={10} max={100} value={speedPercent} onChange={(event) => setSpeedPercent(event.target.value)} required /></label>
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <label>Cargo Alloy<input type="number" min={0} value={cargoAlloy} onChange={(event) => setCargoAlloy(event.target.value)} /></label>
              <label>Cargo Heliox<input type="number" min={0} value={cargoHeliox} onChange={(event) => setCargoHeliox(event.target.value)} /></label>
              <label>Cargo Aether<input type="number" min={0} value={cargoAether} onChange={(event) => setCargoAether(event.target.value)} /></label>
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              {availableShips.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No ships are stationed on this planet.</p> : null}
              {availableShips.map((ship) => (
                <label key={ship.key}>
                  {ship.name} (owned {formatNumber(ship.owned)})
                  <input type="number" min={0} max={ship.owned} value={shipCounts[ship.key] ?? ''} onChange={(event) => setShipCounts((current) => ({ ...current, [ship.key]: event.target.value }))} />
                </label>
              ))}
            </div>
            <button type="submit" className="btn btn-primary" disabled={submitting || availableShips.length === 0}>{submitting ? 'Launching...' : 'Launch fleet'}</button>
          </form>
          <div className="panel stack">
            <h2 style={{ margin: 0 }}>Active missions</h2>
            {missions.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No fleet missions are active.</p> : null}
            {missions.map((mission) => (
              <div className="panel stack" key={mission.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <strong>{enumLabel(mission.missionType)} to {formatCoords({ galaxy: mission.targetGalaxy, system: mission.targetSystem, slot: mission.targetSlot })}</strong>
                  <span className="tag">{enumLabel(mission.status)}</span>
                </div>
                <span style={{ color: 'var(--color-text-muted)' }}>Arrival: {formatDateTime(mission.arrivesAt)} · Speed {mission.speedPercent}%</span>
                <span style={{ color: 'var(--color-text-muted)' }}>Ships: {Object.entries(mission.ships).map(([key, count]) => `${enumLabel(key)} × ${formatNumber(count)}`).join(', ')}</span>
                {mission.status === 'OUTBOUND' ? (
                  <button type="button" onClick={() => recallMission(mission.id)} disabled={recallingId === mission.id}>{recallingId === mission.id ? 'Recalling...' : 'Recall mission'}</button>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

'use client';

import { useCallback, useState } from 'react';
import StatusPanel from '@/components/StatusPanel';
import { apiGet, apiPost } from '@/lib/api';
import { formatCoords, formatDateTime } from '@/lib/formatters';
import { getErrorMessage, useApiData } from '@/lib/useApiData';
import { EonGateSummary, GateFragment, PlanetSummary } from '@/lib/web-types';

export default function GatesPage() {
  const [activatePlanetId, setActivatePlanetId] = useState('');
  const [linkOriginId, setLinkOriginId] = useState('');
  const [linkTargetId, setLinkTargetId] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadGates = useCallback(
    async () => Promise.all([
      apiGet<{ fragments: GateFragment[]; gates: EonGateSummary[]; fragmentsRequired: number }>('/api/gates'),
      apiGet<{ planets: PlanetSummary[] }>('/api/planets'),
    ]),
    [],
  );
  const { data, loading, error, reload } = useApiData(loadGates);
  const fragments = data?.[0]?.fragments ?? [];
  const gates = data?.[0]?.gates ?? [];
  const fragmentsRequired = data?.[0]?.fragmentsRequired ?? 3;
  const planets = data?.[1]?.planets ?? [];

  function planetLabel(planetId: string) {
    const planet = planets.find((p) => p.id === planetId);
    return planet ? `${planet.name} ${formatCoords(planet)}` : planetId;
  }

  async function activateGate() {
    if (!activatePlanetId) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiPost('/api/gates/activate', { planetId: activatePlanetId });
      setActivatePlanetId('');
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function linkGates() {
    if (!linkOriginId || !linkTargetId) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiPost('/api/gates/link', { planetId: linkOriginId, targetPlanetId: linkTargetId });
      setLinkOriginId('');
      setLinkTargetId('');
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack">
      <div className="panel stack">
        <h1 style={{ margin: 0 }}>Eon Gates</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
          Explorers recover Gate Fragments at random from Explore missions. Collect {fragmentsRequired} fragments,
          then activate a Gate Observatory-equipped planet with Gate Theory researched to open an Eon Gate. Link two
          of your activated gates to enable near-instant &quot;Gate Travel&quot; fleet missions between them.
        </p>
      </div>
      {loading ? <StatusPanel message="Loading gate network..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load gate data" message={error} /> : null}
      {actionError ? <StatusPanel tone="error" title="Gate action failed" message={actionError} /> : null}
      {!loading && !error && data ? (
        <>
          <div className="panel stack">
            <h2 style={{ margin: 0 }}>Gate Fragments ({fragments.length}/{fragmentsRequired})</h2>
            {fragments.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No fragments recovered yet.</p> : null}
            <ul>
              {fragments.map((fragment) => (
                <li key={fragment.id}>{fragment.fragmentKey} — found {formatDateTime(fragment.discoveredAt)}</li>
              ))}
            </ul>
          </div>
          <div className="panel stack">
            <h2 style={{ margin: 0 }}>Activate a gate</h2>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <label>Planet
                <select value={activatePlanetId} onChange={(event) => setActivatePlanetId(event.target.value)}>
                  <option value="">Select a planet</option>
                  {planets.map((planet) => (
                    <option key={planet.id} value={planet.id}>{planet.name} {formatCoords(planet)}</option>
                  ))}
                </select>
              </label>
            </div>
            <button type="button" className="btn btn-primary" onClick={activateGate} disabled={busy || !activatePlanetId}>
              {busy ? 'Activating...' : 'Activate gate'}
            </button>
          </div>
          <div className="panel stack">
            <h2 style={{ margin: 0 }}>Your Eon Gates</h2>
            {gates.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No activated gates yet.</p> : null}
            {gates.map((gate) => (
              <div className="panel stack" key={gate.id}>
                <strong>{planetLabel(gate.planetId)}</strong>
                <span style={{ color: 'var(--color-text-muted)' }}>
                  {gate.linkedGateId ? 'Linked and ready for Gate Travel missions.' : 'Not linked to another gate yet.'}
                </span>
              </div>
            ))}
          </div>
          <div className="panel stack">
            <h2 style={{ margin: 0 }}>Link two gates</h2>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <label>Origin gate
                <select value={linkOriginId} onChange={(event) => setLinkOriginId(event.target.value)}>
                  <option value="">Select a planet</option>
                  {gates.map((gate) => (
                    <option key={gate.id} value={gate.planetId}>{planetLabel(gate.planetId)}</option>
                  ))}
                </select>
              </label>
              <label>Target gate
                <select value={linkTargetId} onChange={(event) => setLinkTargetId(event.target.value)}>
                  <option value="">Select a planet</option>
                  {gates.map((gate) => (
                    <option key={gate.id} value={gate.planetId}>{planetLabel(gate.planetId)}</option>
                  ))}
                </select>
              </label>
            </div>
            <button type="button" className="btn btn-primary" onClick={linkGates} disabled={busy || !linkOriginId || !linkTargetId}>
              {busy ? 'Linking...' : 'Link gates'}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

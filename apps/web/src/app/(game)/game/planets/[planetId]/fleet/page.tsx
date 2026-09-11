'use client';

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import StatusPanel from '@/components/StatusPanel';
import { apiGet, apiPost } from '@/lib/api';
import { enumLabel, formatCoords, formatDateTime, formatNumber, formatRelativeCountdown } from '@/lib/formatters';
import { useGameCommand } from '@/lib/GameCommandContext';
import { FleetColonizationsResponse, FleetDeploymentsResponse } from '@/lib/web-types';
import { getErrorMessage, useApiData, useTicker } from '@/lib/useApiData';

function duration(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)} minutes`;
}

export default function FleetPage() {
  const { summary, loading: commandLoading, refresh: refreshCommand } = useGameCommand();
  const originPlanetId = summary?.selectedPlanetId ?? null;
  const now = useTicker();
  const [mode, setMode] = useState<'deploy' | 'colonise'>('deploy');
  const load = useCallback(async (): Promise<FleetDeploymentsResponse | null> => {
    if (!originPlanetId) return null;
    return apiGet<FleetDeploymentsResponse>(`/api/fleet/deployments?originPlanetId=${encodeURIComponent(originPlanetId)}`);
  }, [originPlanetId]);
  const { data, loading, error, reload } = useApiData(load);
  const loadColonization = useCallback(async (): Promise<FleetColonizationsResponse | null> => {
    if (!originPlanetId || mode !== 'colonise') return null;
    return apiGet<FleetColonizationsResponse>(`/api/fleet/colonizations?originPlanetId=${encodeURIComponent(originPlanetId)}`);
  }, [originPlanetId, mode]);
  const {
    data: colonizationData,
    loading: colonizationLoading,
    error: colonizationError,
    reload: reloadColonization,
  } = useApiData(loadColonization);
  const [destinationPlanetId, setDestinationPlanetId] = useState('');
  const [speed, setSpeed] = useState<number | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [targetSlot, setTargetSlot] = useState<number | null>(null);
  const [colonizationConfirmation, setColonizationConfirmation] = useState(false);
  const [colonizationSubmitting, setColonizationSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const expiryRefresh = useRef<string | null>(null);
  const colonizationExpiryRefresh = useRef<string | null>(null);
  const active = data?.activeDeployment ?? null;
  const activeColonization = colonizationData?.activeColonization ?? null;
  const ships = data?.selectedOrigin.ships ?? [];

  useEffect(() => {
    setDestinationPlanetId('');
    setSpeed(null);
    setQuantities({});
    setTargetSlot(null);
    setColonizationConfirmation(false);
    setActionError(null);
    setActionSuccess(null);
    expiryRefresh.current = null;
    colonizationExpiryRefresh.current = null;
  }, [originPlanetId]);

  useEffect(() => {
    if (!data || speed === null || data.supportedSpeedOptions.includes(speed)) return;
    setSpeed(null);
  }, [data, speed]);

  useEffect(() => {
    if (!active) {
      expiryRefresh.current = null;
      return;
    }
    if (now < Date.parse(active.arrivesAt) || expiryRefresh.current === active.id) return;
    expiryRefresh.current = active.id;
    void reload();
    refreshCommand();
  }, [active, now, reload, refreshCommand]);

  useEffect(() => {
    if (!activeColonization) {
      colonizationExpiryRefresh.current = null;
      return;
    }
    const refreshKey = `${activeColonization.origin.id}:${activeColonization.arrivesAt}`;
    if (now < Date.parse(activeColonization.arrivesAt) || colonizationExpiryRefresh.current === refreshKey) return;
    colonizationExpiryRefresh.current = refreshKey;
    void reloadColonization();
    refreshCommand();
  }, [activeColonization, now, reloadColonization, refreshCommand]);

  const selectedShips = useMemo(() => Object.fromEntries(
    ships.flatMap((ship) => {
      const count = Math.max(0, Math.min(ship.count, Math.floor(quantities[ship.key] ?? 0)));
      return count > 0 ? [[ship.key, count] as const] : [];
    }),
  ), [quantities, ships]);
  const canLaunch = !active
    && Boolean(destinationPlanetId)
    && speed !== null
    && Object.keys(selectedShips).length > 0
    && !submitting;

  function setQuantity(key: string, maximum: number, value: number) {
    const safe = Number.isFinite(value) ? Math.floor(value) : 0;
    setQuantities((current) => ({ ...current, [key]: Math.max(0, Math.min(maximum, safe)) }));
  }

  async function launch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!originPlanetId || !destinationPlanetId || speed === null || Object.keys(selectedShips).length === 0) return;
    setSubmitting(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await apiPost('/api/fleet/deployments', {
        originPlanetId,
        destinationPlanetId,
        speed,
        ships: selectedShips,
      });
      setQuantities({});
      await reload();
      refreshCommand();
      setActionSuccess('Deployment accepted. The server-confirmed fleet state is now shown below.');
    } catch (failure) {
      setActionError(getErrorMessage(failure));
    } finally {
      setSubmitting(false);
    }
  }

  async function launchColonization() {
    if (!originPlanetId || targetSlot === null || activeColonization || !colonizationConfirmation) return;
    setColonizationSubmitting(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await apiPost('/api/fleet/colonizations', { originPlanetId, targetSlot });
      setTargetSlot(null);
      setColonizationConfirmation(false);
      await reloadColonization();
      refreshCommand();
      setActionSuccess('Colonisation accepted. The server-confirmed mission state is now shown below.');
    } catch (failure) {
      setActionError(getErrorMessage(failure));
    } finally {
      setColonizationSubmitting(false);
    }
  }

  function changeMode(nextMode: 'deploy' | 'colonise') {
    setMode(nextMode);
    setActionError(null);
    setActionSuccess(null);
    setColonizationConfirmation(false);
  }

  function handleModeKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextMode = event.key === 'Home' || event.key === 'ArrowLeft' ? 'deploy' : 'colonise';
    changeMode(nextMode);
    document.getElementById(`fleet-mode-${nextMode}`)?.focus();
  }

  return (
    <section className="stack">
      <div className="panel stack">
        <h1 style={{ margin: 0 }}>Fleet command</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
          {mode === 'deploy'
            ? 'Send ships between your own planets. Cargo, recall and all cross-player missions are not available yet.'
            : 'Found a new world in this system. Cargo, recall and all cross-player missions are not available yet.'}
        </p>
        <div className="button-row" role="tablist" aria-label="Fleet command mode">
          <button id="fleet-mode-deploy" type="button" role="tab" aria-selected={mode === 'deploy'} aria-controls="fleet-mode-panel" tabIndex={mode === 'deploy' ? 0 : -1} onClick={() => changeMode('deploy')} onKeyDown={handleModeKey}>Deploy</button>
          <button id="fleet-mode-colonise" type="button" role="tab" aria-selected={mode === 'colonise'} aria-controls="fleet-mode-panel" tabIndex={mode === 'colonise' ? 0 : -1} onClick={() => changeMode('colonise')} onKeyDown={handleModeKey}>Colonise</button>
        </div>
      </div>
      {commandLoading && !originPlanetId ? <StatusPanel message="Loading selected planet..." /> : null}
      {mode === 'deploy' && loading && !data ? <StatusPanel message="Loading authoritative deployment state..." /> : null}
      {mode === 'deploy' && error && !data ? <StatusPanel tone="error" title="Fleet deployment unavailable" message={error} /> : null}
      {mode === 'colonise' && colonizationLoading && !colonizationData ? <StatusPanel message="Loading authoritative colonisation state..." /> : null}
      {mode === 'colonise' && colonizationError && !colonizationData ? <StatusPanel tone="error" title="Colonisation unavailable" message={colonizationError} /> : null}
      {actionError ? <div className="alert alert-error" role="alert">{actionError}</div> : null}
      {actionSuccess ? <p className="alert" role="status">{actionSuccess}</p> : null}
      {!commandLoading && !originPlanetId ? <StatusPanel title="No selected planet" message="Select an owned planet before preparing a deployment." /> : null}
      {mode === 'deploy' && data ? <div id="fleet-mode-panel" role="tabpanel" aria-labelledby="fleet-mode-deploy" className="stack">
        <div className="panel stack" aria-live="polite">
          <h2 style={{ margin: 0 }}>Selected origin</h2>
          <p style={{ margin: 0 }}><strong>{data.selectedOrigin.name}</strong> {formatCoords(data.selectedOrigin.coordinates)}</p>
          <p style={{ margin: 0 }}>Available Heliox: {formatNumber(data.selectedOrigin.heliox)}</p>
        </div>

        {active ? <div className="panel stack" role="status" aria-live="polite">
          <h2 style={{ margin: 0 }}>Deployment in progress</h2>
          <p style={{ margin: 0 }}><strong>{data.selectedOrigin.name} {formatCoords(data.selectedOrigin.coordinates)}</strong> → <strong>{active.destination.name} {formatCoords(active.destination.coordinates)}</strong></p>
          <p style={{ margin: 0 }}>Ships: {Object.entries(active.ships).map(([key, count]) => `${enumLabel(key)} × ${formatNumber(count)}`).join(', ')}</p>
          <dl className="research-details">
            <div><dt>Accepted fuel</dt><dd>{formatNumber(active.fuelHeliox)} Heliox</dd></div>
            <div><dt>Accepted duration</dt><dd>{duration(active.durationSeconds)}</dd></div>
            <div><dt>Departed</dt><dd>{formatDateTime(active.departedAt)}</dd></div>
            <div><dt>Arrival</dt><dd>{formatDateTime(active.arrivesAt)}</dd></div>
            <div><dt>Status</dt><dd>{enumLabel(active.status)}</dd></div>
          </dl>
          <p style={{ margin: 0 }}>{now >= Date.parse(active.arrivesAt) ? 'Confirming arrival with the server…' : `${formatRelativeCountdown(active.arrivesAt, now)} remaining`}</p>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Another deployment cannot launch from this origin until this one completes. Recall and cargo are not available in this slice.</p>
        </div> : data.eligibleDestinations.length === 0 ? <StatusPanel title="Another owned planet required" message="Deployment is available only between your own planets. Establish or acquire another owned planet before sending ships." /> : <form className="panel stack" onSubmit={launch}>
          <h2 style={{ margin: 0 }}>Prepare deployment</h2>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Fuel and arrival are confirmed by command on launch.</p>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <label htmlFor="deploy-destination">Destination
              <select id="deploy-destination" value={destinationPlanetId} onChange={(event) => setDestinationPlanetId(event.target.value)} disabled={submitting} required>
                <option value="">Select an owned destination</option>
                {data.eligibleDestinations.map((destination) => <option key={destination.id} value={destination.id}>{destination.name} {formatCoords(destination.coordinates)}</option>)}
              </select>
            </label>
            <label htmlFor="deploy-speed">Speed
              <select id="deploy-speed" value={speed ?? ''} onChange={(event) => setSpeed(Number(event.target.value))} disabled={submitting} required>
                <option value="">Select speed</option>
                {data.supportedSpeedOptions.map((option) => <option key={option} value={option}>{option}%</option>)}
              </select>
            </label>
          </div>
          <div className="stack">
            <h3 style={{ margin: 0 }}>Available ships</h3>
            {ships.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No ships are currently available at this origin.</p> : <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              {ships.map((ship) => {
                const quantity = Math.max(0, Math.min(ship.count, quantities[ship.key] ?? 0));
                return <article className="panel stack" key={ship.key}>
                  <div className="research-card-heading"><h4 style={{ margin: 0 }}>{enumLabel(ship.key)}</h4><span className="tag">Available {formatNumber(ship.count)}</span></div>
                  <label htmlFor={`deploy-quantity-${ship.key}`}>Send quantity</label>
                  <div className="button-row">
                    <button type="button" onClick={() => setQuantity(ship.key, ship.count, quantity - 1)} disabled={submitting || quantity === 0} aria-label={`Decrease ${enumLabel(ship.key)} quantity`}>−</button>
                    <input id={`deploy-quantity-${ship.key}`} type="number" min="0" max={ship.count} value={quantity} onChange={(event) => setQuantity(ship.key, ship.count, Number(event.target.value))} disabled={submitting} />
                    <button type="button" onClick={() => setQuantity(ship.key, ship.count, quantity + 1)} disabled={submitting || quantity >= ship.count} aria-label={`Increase ${enumLabel(ship.key)} quantity`}>+</button>
                  </div>
                </article>;
              })}
            </div>}
          </div>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }} role="status">Choose a destination, speed and at least one available ship to submit this deploy command.</p>
          <button type="submit" className="btn btn-primary" disabled={!canLaunch}>{submitting ? 'Submitting deployment…' : 'Confirm deployment'}</button>
        </form>}
      </div> : null}
      {mode === 'colonise' && colonizationData ? <div id="fleet-mode-panel" role="tabpanel" aria-labelledby="fleet-mode-colonise" className="stack">
        <div className="panel stack" aria-live="polite">
          <h2 style={{ margin: 0 }}>Selected origin</h2>
          <p style={{ margin: 0 }}><strong>{colonizationData.selectedOrigin.name}</strong> {formatCoords(colonizationData.selectedOrigin.coordinates)}</p>
          <p style={{ margin: 0 }}>Available Colony Ships: {formatNumber(colonizationData.selectedOrigin.availableColonyShips)}</p>
          <p style={{ margin: 0 }}>Available Heliox: {formatNumber(colonizationData.selectedOrigin.heliox)}</p>
        </div>

        {activeColonization ? <div className="panel stack" role="status" aria-live="polite">
          <h2 style={{ margin: 0 }}>Colonisation in progress</h2>
          <p style={{ margin: 0 }}><strong>{activeColonization.origin.name} {formatCoords(activeColonization.origin.coordinates)}</strong> → <strong>{formatCoords(activeColonization.target.coordinates)}</strong></p>
          <dl className="research-details">
            <div><dt>Departed</dt><dd>{formatDateTime(activeColonization.departedAt)}</dd></div>
            <div><dt>Arrival</dt><dd>{formatDateTime(activeColonization.arrivesAt)}</dd></div>
            <div><dt>Status</dt><dd>{enumLabel(activeColonization.status)}</dd></div>
          </dl>
          <p style={{ margin: 0 }}>{now >= Date.parse(activeColonization.arrivesAt) ? 'Confirming colony arrival with the server…' : `${formatRelativeCountdown(activeColonization.arrivesAt, now)} remaining`}</p>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Only one colonisation can be active for this account. Cargo and recall are not available in this slice.</p>
        </div> : <div className="panel stack">
          <h2 style={{ margin: 0 }}>Prepare colonisation</h2>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>A colony mission consumes one Colony Ship, carries no cargo and cannot be recalled. Fuel and arrival are confirmed by the server when you launch.</p>
          {colonizationData.availableTargetSlots.length === 0 ? <StatusPanel title="No available target slots" message="Every other slot in this system is occupied or reserved. Choose a different origin after the system changes." /> : <fieldset className="stack" disabled={colonizationSubmitting}>
            <legend>Available same-system target slots</legend>
            <div className="button-row" aria-label="Available colonisation target slots">
              {colonizationData.availableTargetSlots.map((slot) => <button key={slot} type="button" aria-pressed={targetSlot === slot} onClick={() => { setTargetSlot(slot); setColonizationConfirmation(false); }}>Slot {slot}</button>)}
            </div>
          </fieldset>}
          {colonizationData.selectedOrigin.availableColonyShips < 1 ? <p className="alert alert-error" role="status">A Colony Ship is required before this origin can found a new world.</p> : null}
          {!colonizationConfirmation ? <button type="button" className="btn btn-primary" disabled={colonizationSubmitting || targetSlot === null || colonizationData.selectedOrigin.availableColonyShips < 1} onClick={() => setColonizationConfirmation(true)}>Review colonisation</button> : <div className="panel stack" role="status" aria-live="polite">
            <h3 style={{ margin: 0 }}>Confirm colonisation</h3>
            <p style={{ margin: 0 }}>Send one Colony Ship from {colonizationData.selectedOrigin.name} to slot {targetSlot}. This command has no cargo or recall and is confirmed by the server.</p>
            <div className="button-row">
              <button type="button" onClick={() => setColonizationConfirmation(false)} disabled={colonizationSubmitting}>Change target</button>
              <button type="button" className="btn btn-primary" onClick={() => void launchColonization()} disabled={colonizationSubmitting}>{colonizationSubmitting ? 'Submitting colonisation…' : 'Confirm colonisation'}</button>
            </div>
          </div>}
        </div>}
      </div> : null}
    </section>
  );
}

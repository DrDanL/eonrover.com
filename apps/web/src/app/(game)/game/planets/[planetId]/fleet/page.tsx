'use client';

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import StatusPanel from '@/components/StatusPanel';
import { apiGet, apiPost } from '@/lib/api';
import { enumLabel, formatCoords, formatDateTime, formatNumber, formatRelativeCountdown } from '@/lib/formatters';
import { useGameCommand } from '@/lib/GameCommandContext';
import { FleetColonizationsResponse, FleetDeploymentsResponse, FleetEspionageResponse, FleetTransportsResponse, ResourceAmounts } from '@/lib/web-types';
import { getErrorMessage, useApiData, useTicker } from '@/lib/useApiData';

function duration(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)} minutes`;
}

type FleetMode = 'deploy' | 'colonise' | 'transport' | 'espionage';

const fleetModes: FleetMode[] = ['deploy', 'colonise', 'transport', 'espionage'];

const emptyCargo: ResourceAmounts = { alloy: 0, heliox: 0, aether: 0 };

type EspionageTarget = { galaxy: number; system: number; slot: number };

function queryCoordinate(value: string | null, maximum: number): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
}

function queryEspionageTarget(searchParams: URLSearchParams): EspionageTarget | null {
  const galaxy = queryCoordinate(searchParams.get('targetGalaxy'), 6);
  const system = queryCoordinate(searchParams.get('targetSystem'), 400);
  const slot = queryCoordinate(searchParams.get('targetSlot'), 12);
  return galaxy !== null && system !== null && slot !== null ? { galaxy, system, slot } : null;
}

export default function FleetPage() {
  const { summary, loading: commandLoading, refresh: refreshCommand } = useGameCommand();
  const searchParams = useSearchParams();
  const originPlanetId = summary?.selectedPlanetId ?? null;
  const now = useTicker();
  const [mode, setMode] = useState<FleetMode>('deploy');
  const espionageTarget = useMemo(() => queryEspionageTarget(searchParams), [searchParams]);
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
  const loadTransport = useCallback(async (): Promise<FleetTransportsResponse | null> => {
    if (!originPlanetId || mode !== 'transport') return null;
    return apiGet<FleetTransportsResponse>(`/api/fleet/transports?originPlanetId=${encodeURIComponent(originPlanetId)}`);
  }, [originPlanetId, mode]);
  const {
    data: transportData,
    loading: transportLoading,
    error: transportError,
    reload: reloadTransport,
  } = useApiData(loadTransport);
  const loadEspionage = useCallback(async (): Promise<FleetEspionageResponse | null> => {
    if (!originPlanetId || mode !== 'espionage') return null;
    return apiGet<FleetEspionageResponse>(`/api/fleet/espionage?originPlanetId=${encodeURIComponent(originPlanetId)}`);
  }, [originPlanetId, mode]);
  const {
    data: espionageData,
    loading: espionageLoading,
    error: espionageError,
    reload: reloadEspionage,
  } = useApiData(loadEspionage);
  const [destinationPlanetId, setDestinationPlanetId] = useState('');
  const [speed, setSpeed] = useState<number | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [targetSlot, setTargetSlot] = useState<number | null>(null);
  const [colonizationConfirmation, setColonizationConfirmation] = useState(false);
  const [colonizationSubmitting, setColonizationSubmitting] = useState(false);
  const [transportDestinationPlanetId, setTransportDestinationPlanetId] = useState('');
  const [transporterQuantity, setTransporterQuantity] = useState(1);
  const [transportCargo, setTransportCargo] = useState<ResourceAmounts>(emptyCargo);
  const [transportConfirmation, setTransportConfirmation] = useState(false);
  const [transportSubmitting, setTransportSubmitting] = useState(false);
  const [espionageConfirmation, setEspionageConfirmation] = useState(false);
  const [espionageSubmitting, setEspionageSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const expiryRefresh = useRef<string | null>(null);
  const colonizationExpiryRefresh = useRef<string | null>(null);
  const transportExpiryRefresh = useRef<string | null>(null);
  const espionageExpiryRefresh = useRef<string | null>(null);
  const active = data?.activeDeployment ?? null;
  const activeColonization = colonizationData?.activeColonization ?? null;
  const activeTransport = transportData?.activeTransport ?? null;
  const activeEspionage = espionageData?.activeEspionage ?? null;
  const ships = data?.selectedOrigin.ships ?? [];

  useEffect(() => {
    setDestinationPlanetId('');
    setSpeed(null);
    setQuantities({});
    setTargetSlot(null);
    setColonizationConfirmation(false);
    setTransportDestinationPlanetId('');
    setTransporterQuantity(1);
    setTransportCargo(emptyCargo);
    setTransportConfirmation(false);
    setEspionageConfirmation(false);
    setActionError(null);
    setActionSuccess(null);
    expiryRefresh.current = null;
    colonizationExpiryRefresh.current = null;
    transportExpiryRefresh.current = null;
    espionageExpiryRefresh.current = null;
  }, [originPlanetId]);

  useEffect(() => {
    if (searchParams.get('mode') === 'espionage') setMode('espionage');
  }, [searchParams]);

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

  useEffect(() => {
    if (!activeTransport || activeTransport.phase === 'AWAITING_DESTINATION_CAPACITY') {
      if (!activeTransport) transportExpiryRefresh.current = null;
      return;
    }
    const dueAt = activeTransport.phase === 'RETURNING' ? activeTransport.returnsAt : activeTransport.arrivesAt;
    const refreshKey = `${activeTransport.id}:${activeTransport.phase}:${dueAt ?? ''}`;
    if (!dueAt || now < Date.parse(dueAt) || transportExpiryRefresh.current === refreshKey) return;
    transportExpiryRefresh.current = refreshKey;
    void reloadTransport();
    refreshCommand();
  }, [activeTransport, now, reloadTransport, refreshCommand]);

  useEffect(() => {
    if (!activeEspionage) {
      espionageExpiryRefresh.current = null;
      return;
    }
    const dueAt = activeEspionage.phase === 'RETURNING' ? activeEspionage.returnsAt : activeEspionage.arrivesAt;
    const refreshKey = `${activeEspionage.phase}:${dueAt}`;
    if (now < Date.parse(dueAt) || espionageExpiryRefresh.current === refreshKey) return;
    espionageExpiryRefresh.current = refreshKey;
    void reloadEspionage();
    refreshCommand();
  }, [activeEspionage, now, reloadEspionage, refreshCommand]);

  useEffect(() => {
    if (mode !== 'transport' || activeTransport?.phase !== 'AWAITING_DESTINATION_CAPACITY') return;
    const interval = window.setInterval(() => {
      void reloadTransport();
      refreshCommand();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [activeTransport?.phase, mode, reloadTransport, refreshCommand]);

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
  const transportCargoTotal = transportCargo.alloy + transportCargo.heliox + transportCargo.aether;
  const validTransportRequest = Number.isSafeInteger(transporterQuantity)
    && transporterQuantity >= 1
    && transporterQuantity <= 100
    && Object.values(transportCargo).every((amount) => Number.isSafeInteger(amount) && amount >= 0)
    && Number.isSafeInteger(transportCargoTotal)
    && transportCargoTotal > 0;
  const canReviewTransport = !activeTransport
    && Boolean(transportDestinationPlanetId)
    && validTransportRequest
    && !transportSubmitting;
  const canReviewEspionage = !activeEspionage
    && espionageTarget !== null
    && (espionageData?.selectedOrigin.availableProbes ?? 0) >= 1
    && (espionageData?.selectedOrigin.espionageTechnologyLevel ?? 0) >= 1
    && !espionageSubmitting;

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

  function setCargoResource(resource: keyof ResourceAmounts, value: number) {
    setTransportCargo((current) => ({ ...current, [resource]: value }));
    setTransportConfirmation(false);
  }

  async function launchTransport() {
    if (!originPlanetId || !transportDestinationPlanetId || activeTransport || !transportConfirmation || !validTransportRequest) return;
    setTransportSubmitting(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await apiPost('/api/fleet/transports', {
        originPlanetId,
        destinationPlanetId: transportDestinationPlanetId,
        transporterQuantity,
        cargo: transportCargo,
      });
      setTransportConfirmation(false);
      await reloadTransport();
      refreshCommand();
      setActionSuccess('Transport accepted. The server-confirmed transport state is now shown below.');
    } catch (failure) {
      setActionError(getErrorMessage(failure));
    } finally {
      setTransportSubmitting(false);
    }
  }

  async function launchEspionage() {
    if (!originPlanetId || !espionageTarget || activeEspionage || !espionageConfirmation) return;
    setEspionageSubmitting(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await apiPost('/api/fleet/espionage', { originPlanetId, target: espionageTarget });
      setEspionageConfirmation(false);
      await reloadEspionage();
      refreshCommand();
      setActionSuccess('Espionage Probe accepted. The server-confirmed mission state is now shown below.');
    } catch (failure) {
      setActionError(getErrorMessage(failure));
    } finally {
      setEspionageSubmitting(false);
    }
  }

  function changeMode(nextMode: FleetMode) {
    setMode(nextMode);
    setActionError(null);
    setActionSuccess(null);
    setColonizationConfirmation(false);
    setTransportConfirmation(false);
    setEspionageConfirmation(false);
  }

  function handleModeKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = fleetModes.indexOf(mode);
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? fleetModes.length - 1
        : (currentIndex + (event.key === 'ArrowLeft' ? -1 : 1) + fleetModes.length) % fleetModes.length;
    const nextMode = fleetModes[nextIndex];
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
              : mode === 'colonise'
                ? 'Found a new world in this system. Cargo, recall and all cross-player missions are not available yet.'
                : mode === 'transport'
                  ? 'Move resources between your own planets. Cargo is delivered only when the destination can hold it, and Transporters return automatically.'
                  : 'Send one Probe to a public Galaxy coordinate. Intelligence gathering only: no cargo, recall, combat or mission controls are available.'}
          </p>
          <div className="button-row" role="tablist" aria-label="Fleet command mode">
            <button id="fleet-mode-deploy" type="button" role="tab" aria-selected={mode === 'deploy'} aria-controls="fleet-mode-panel" tabIndex={mode === 'deploy' ? 0 : -1} onClick={() => changeMode('deploy')} onKeyDown={handleModeKey}>Deploy</button>
            <button id="fleet-mode-colonise" type="button" role="tab" aria-selected={mode === 'colonise'} aria-controls="fleet-mode-panel" tabIndex={mode === 'colonise' ? 0 : -1} onClick={() => changeMode('colonise')} onKeyDown={handleModeKey}>Colonise</button>
            <button id="fleet-mode-transport" type="button" role="tab" aria-selected={mode === 'transport'} aria-controls="fleet-mode-panel" tabIndex={mode === 'transport' ? 0 : -1} onClick={() => changeMode('transport')} onKeyDown={handleModeKey}>Transport</button>
            <button id="fleet-mode-espionage" type="button" role="tab" aria-selected={mode === 'espionage'} aria-controls="fleet-mode-panel" tabIndex={mode === 'espionage' ? 0 : -1} onClick={() => changeMode('espionage')} onKeyDown={handleModeKey}>Espionage</button>
          </div>
      </div>
      {commandLoading && !originPlanetId ? <StatusPanel message="Loading selected planet..." /> : null}
      {mode === 'deploy' && loading && !data ? <StatusPanel message="Loading authoritative deployment state..." /> : null}
      {mode === 'deploy' && error && !data ? <StatusPanel tone="error" title="Fleet deployment unavailable" message={error} /> : null}
      {mode === 'colonise' && colonizationLoading && !colonizationData ? <StatusPanel message="Loading authoritative colonisation state..." /> : null}
      {mode === 'colonise' && colonizationError && !colonizationData ? <StatusPanel tone="error" title="Colonisation unavailable" message={colonizationError} /> : null}
      {mode === 'transport' && transportLoading && !transportData ? <StatusPanel message="Loading authoritative transport state..." /> : null}
      {mode === 'transport' && transportError && !transportData ? <StatusPanel tone="error" title="Transport unavailable" message={transportError} /> : null}
      {mode === 'espionage' && espionageLoading && !espionageData ? <StatusPanel message="Loading authoritative Probe state..." /> : null}
      {mode === 'espionage' && espionageError && !espionageData ? <StatusPanel tone="error" title="Espionage unavailable" message={espionageError} /> : null}
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
      {mode === 'transport' && transportData ? <div id="fleet-mode-panel" role="tabpanel" aria-labelledby="fleet-mode-transport" className="stack">
        <div className="panel stack" aria-live="polite">
          <h2 style={{ margin: 0 }}>Selected origin</h2>
          <p style={{ margin: 0 }}><strong>{transportData.selectedOrigin.name}</strong> {formatCoords(transportData.selectedOrigin.coordinates)}</p>
          <dl className="research-details">
            <div><dt>Alloy</dt><dd>{formatNumber(transportData.selectedOrigin.resources.alloy)}</dd></div>
            <div><dt>Heliox</dt><dd>{formatNumber(transportData.selectedOrigin.resources.heliox)}</dd></div>
            <div><dt>Aether</dt><dd>{formatNumber(transportData.selectedOrigin.resources.aether)}</dd></div>
            <div><dt>Transporters</dt><dd>{formatNumber(transportData.selectedOrigin.transporterCount)}</dd></div>
            <div><dt>Capacity per Transporter</dt><dd>{formatNumber(transportData.transporterCapacityPerShip)}</dd></div>
          </dl>
        </div>

        {activeTransport ? <div className="panel stack" role="status" aria-live="polite">
          <h2 style={{ margin: 0 }}>Transport in progress</h2>
          <p style={{ margin: 0 }}><strong>{activeTransport.origin.name} {formatCoords(activeTransport.origin.coordinates)}</strong> → <strong>{activeTransport.destination.name} {formatCoords(activeTransport.destination.coordinates)}</strong></p>
          <dl className="research-details">
            <div><dt>Transporters</dt><dd>{formatNumber(activeTransport.transporterQuantity)}</dd></div>
            <div><dt>Remaining cargo</dt><dd>Alloy {formatNumber(activeTransport.remainingCargo.alloy)}, Heliox {formatNumber(activeTransport.remainingCargo.heliox)}, Aether {formatNumber(activeTransport.remainingCargo.aether)}</dd></div>
            <div><dt>Phase</dt><dd>{enumLabel(activeTransport.phase)}</dd></div>
            <div><dt>Departed</dt><dd>{formatDateTime(activeTransport.departedAt)}</dd></div>
            <div><dt>Arrival</dt><dd>{formatDateTime(activeTransport.arrivesAt)}</dd></div>
            {activeTransport.returnsAt ? <div><dt>Return</dt><dd>{formatDateTime(activeTransport.returnsAt)}</dd></div> : null}
          </dl>
          {activeTransport.phase === 'AWAITING_DESTINATION_CAPACITY' ? <>
            <p className="alert" style={{ margin: 0 }}>{activeTransport.capacityWaitMessage ?? 'The destination needs enough storage capacity before the full cargo can be delivered. No cargo has been lost.'}</p>
            <div className="button-row">
              <button type="button" onClick={() => { void reloadTransport(); refreshCommand(); }} disabled={transportLoading}>Refresh transport status</button>
            </div>
            <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>The command checks again periodically while the destination capacity changes.</p>
          </> : (() => {
            const nextEventAt = activeTransport.phase === 'RETURNING' ? activeTransport.returnsAt : activeTransport.arrivesAt;
            return <p style={{ margin: 0 }}>{!nextEventAt || now >= Date.parse(nextEventAt) ? 'Confirming transport state with the server…' : `${formatRelativeCountdown(nextEventAt, now)} until the next server-confirmed transport event`}</p>;
          })()}
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>A new transport cannot launch from this origin until this mission completes. Recall and cancellation are not available in this version.</p>
        </div> : transportData.eligibleDestinations.length === 0 ? <StatusPanel title="Another owned planet required" message="Transport is available only between your own planets. Establish or acquire another owned planet before sending resources." /> : <form className="panel stack" onSubmit={(event) => { event.preventDefault(); if (canReviewTransport) setTransportConfirmation(true); }}>
          <h2 style={{ margin: 0 }}>Prepare transport</h2>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>The server confirms capacity, fuel, timing and availability when you launch. Cargo may include Heliox; round-trip fuel is reserved separately by command.</p>
          {transportData.selectedOrigin.transporterCount < 1 ? <p className="alert alert-error" role="status">At least one Transporter is required before this origin can send cargo.</p> : null}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <label htmlFor="transport-destination">Destination
              <select id="transport-destination" value={transportDestinationPlanetId} onChange={(event) => { setTransportDestinationPlanetId(event.target.value); setTransportConfirmation(false); }} disabled={transportSubmitting || transportData.selectedOrigin.transporterCount < 1} required>
                <option value="">Select an owned destination</option>
                {transportData.eligibleDestinations.map((destination) => <option key={destination.id} value={destination.id}>{destination.name} {formatCoords(destination.coordinates)}</option>)}
              </select>
            </label>
            <label htmlFor="transport-quantity">Transporters to send
              <input id="transport-quantity" type="number" min="1" max="100" step="1" inputMode="numeric" value={transporterQuantity} onChange={(event) => { setTransporterQuantity(Number(event.target.value)); setTransportConfirmation(false); }} disabled={transportSubmitting || transportData.selectedOrigin.transporterCount < 1} aria-describedby="transport-form-help" required />
            </label>
          </div>
          <fieldset className="stack" disabled={transportSubmitting || transportData.selectedOrigin.transporterCount < 1}>
            <legend>Cargo to send</legend>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              {(['alloy', 'heliox', 'aether'] as const).map((resource) => <label key={resource} htmlFor={`transport-cargo-${resource}`}>{enumLabel(resource)}
                <input id={`transport-cargo-${resource}`} type="number" min="0" step="1" inputMode="numeric" value={transportCargo[resource]} onChange={(event) => setCargoResource(resource, Number(event.target.value))} aria-describedby="transport-form-help" required />
              </label>)}
            </div>
          </fieldset>
          <p id="transport-form-help" style={{ margin: 0, color: 'var(--color-text-muted)' }}>Choose an owned destination, a whole number of Transporters from 1 to 100, and at least one whole cargo unit. The server validates all affordability and capacity rules.</p>
          {!validTransportRequest ? <p className="alert alert-error" role="status">Enter whole, non-negative cargo amounts with at least one cargo unit, and a Transporter quantity from 1 to 100.</p> : null}
          {!transportConfirmation ? <button type="submit" className="btn btn-primary" disabled={!canReviewTransport}>{transportSubmitting ? 'Submitting transport…' : 'Review transport'}</button> : <div className="panel stack" role="status" aria-live="polite">
            <h3 style={{ margin: 0 }}>Confirm transport</h3>
            <p style={{ margin: 0 }}>Send {formatNumber(transporterQuantity)} Transporter{transporterQuantity === 1 ? '' : 's'} from {transportData.selectedOrigin.name} to {transportData.eligibleDestinations.find((destination) => destination.id === transportDestinationPlanetId)?.name ?? 'the selected destination'} with Alloy {formatNumber(transportCargo.alloy)}, Heliox {formatNumber(transportCargo.heliox)}, and Aether {formatNumber(transportCargo.aether)}.</p>
            <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Transport travels at the server-controlled speed. Cargo is delivered only when the destination can hold it, Transporters return automatically after delivery, and there is no recall or cancellation in this version.</p>
            <div className="button-row">
              <button type="button" onClick={() => { setTransportConfirmation(false); void reloadTransport(); refreshCommand(); }} disabled={transportSubmitting}>Change transport</button>
              <button type="button" className="btn btn-primary" onClick={() => void launchTransport()} disabled={transportSubmitting}>{transportSubmitting ? 'Submitting transport…' : 'Confirm transport'}</button>
            </div>
          </div>}
        </form>}
      </div> : null}
      {mode === 'espionage' && espionageData ? <div id="fleet-mode-panel" role="tabpanel" aria-labelledby="fleet-mode-espionage" className="stack">
        <div className="panel stack" aria-live="polite">
          <h2 style={{ margin: 0 }}>Selected origin</h2>
          <p style={{ margin: 0 }}>{formatCoords(espionageData.selectedOrigin.coordinates)}</p>
          <dl className="research-details">
            <div><dt>Available Heliox</dt><dd>{formatNumber(espionageData.selectedOrigin.heliox)}</dd></div>
            <div><dt>Available Probes</dt><dd>{formatNumber(espionageData.selectedOrigin.availableProbes)}</dd></div>
            <div><dt>Espionage Technology</dt><dd>Level {formatNumber(espionageData.selectedOrigin.espionageTechnologyLevel)}</dd></div>
          </dl>
        </div>

        {activeEspionage ? <div className="panel stack" role="status" aria-live="polite">
          <h2 style={{ margin: 0 }}>Espionage Probe in progress</h2>
          <p style={{ margin: 0 }}><strong>{formatCoords(espionageData.selectedOrigin.coordinates)}</strong> → <strong>{formatCoords(activeEspionage.target.coordinates)}</strong></p>
          <dl className="research-details">
            <div><dt>Phase</dt><dd>{enumLabel(activeEspionage.phase)}</dd></div>
            <div><dt>Departed</dt><dd>{formatDateTime(activeEspionage.departedAt)}</dd></div>
            <div><dt>Arrival</dt><dd>{formatDateTime(activeEspionage.arrivesAt)}</dd></div>
            <div><dt>Return</dt><dd>{formatDateTime(activeEspionage.returnsAt)}</dd></div>
            <div><dt>Intelligence report</dt><dd>{activeEspionage.intelligenceReportReady ? 'Ready' : 'Pending arrival'}</dd></div>
          </dl>
          {(() => {
            const dueAt = activeEspionage.phase === 'RETURNING' ? activeEspionage.returnsAt : activeEspionage.arrivesAt;
            return <p style={{ margin: 0 }}>{now >= Date.parse(dueAt) ? 'Confirming Probe state with the server…' : `${formatRelativeCountdown(dueAt, now)} until the next server-confirmed Probe event`}</p>;
          })()}
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Another Probe mission cannot launch from this origin until this Probe returns. Cargo, recall and combat are not available in this slice.</p>
        </div> : !espionageTarget ? <div className="panel stack">
          <h2 style={{ margin: 0 }}>Choose a public Galaxy target</h2>
          <p style={{ margin: 0 }}>Select an occupied public Galaxy slot, then use Send Probe to return here with its coordinates.</p>
          <div><Link className="btn" href="/game/galaxy">Browse Galaxy</Link></div>
        </div> : <div className="panel stack">
          <h2 style={{ margin: 0 }}>Prepare Espionage Probe</h2>
          <p style={{ margin: 0 }}>Selected target: <strong>{formatCoords(espionageTarget)}</strong></p>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>One Probe is committed temporarily. The server validates this public target and calculates the journey and Heliox requirement.</p>
          {espionageData.selectedOrigin.espionageTechnologyLevel < 1 ? <p className="alert alert-error" role="status">Espionage Technology level 1 is required before launching a Probe.</p> : null}
          {espionageData.selectedOrigin.availableProbes < 1 ? <p className="alert alert-error" role="status">One available Probe is required before launching this mission.</p> : null}
          {!espionageConfirmation ? <div className="button-row">
            <button type="button" className="btn btn-primary" disabled={!canReviewEspionage} onClick={() => setEspionageConfirmation(true)}>Review Probe mission</button>
            <Link className="btn" href="/game/galaxy">Choose another Galaxy target</Link>
          </div> : <div className="panel stack" role="status" aria-live="polite">
            <h3 style={{ margin: 0 }}>Confirm Espionage Probe</h3>
            <p style={{ margin: 0 }}>Send one Probe from {formatCoords(espionageData.selectedOrigin.coordinates)} to {formatCoords(espionageTarget)}. The server confirms target availability, protection, Heliox and timing. This mission has no cargo or recall.</p>
            <div className="button-row">
              <button type="button" onClick={() => setEspionageConfirmation(false)} disabled={espionageSubmitting}>Change target</button>
              <button type="button" className="btn btn-primary" onClick={() => void launchEspionage()} disabled={espionageSubmitting}>{espionageSubmitting ? 'Submitting Probe…' : 'Confirm Probe mission'}</button>
            </div>
          </div>}
        </div>}
      </div> : null}
    </section>
  );
}

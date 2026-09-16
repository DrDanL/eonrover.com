'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef } from 'react';
import StatusPanel from '@/components/StatusPanel';
import { apiGet } from '@/lib/api';
import { enumLabel, formatCoords, formatDateTime, formatNumber } from '@/lib/formatters';
import { MissionControlOperation, MissionControlResponse } from '@/lib/web-types';
import { useApiData, useTicker } from '@/lib/useApiData';

function formatCountdown(target: string | null, now: number): string {
  if (!target) return 'Waiting for destination capacity';
  const remaining = Math.max(0, Math.ceil((new Date(target).getTime() - now) / 1_000));
  const hours = Math.floor(remaining / 3_600);
  const minutes = Math.floor((remaining % 3_600) / 60);
  const seconds = remaining % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

function operationLabel(operation: MissionControlOperation): string {
  return enumLabel(operation.missionType);
}

function ManifestSummary({ operation }: { operation: MissionControlOperation }) {
  const manifest = Object.entries(operation.manifest).map(([key, count]) => `${formatNumber(count)} ${enumLabel(key)}`).join(', ');
  const cargo = operation.cargo ? ` · Cargo: ${formatNumber(operation.cargo.alloy)} Alloy, ${formatNumber(operation.cargo.heliox)} Heliox, ${formatNumber(operation.cargo.aether)} Aether` : '';
  return <p style={{ margin: 0 }}>{manifest}{cargo}</p>;
}

function OperationCard({ operation, now }: { operation: MissionControlOperation; now: number }) {
  const nextLabel = operation.phase === 'AWAITING_DESTINATION_CAPACITY'
    ? 'Capacity wait'
    : operation.direction === 'RETURNING' ? 'Return due' : 'Arrival due';
  return (
    <article className="panel stack" aria-label={`${operationLabel(operation)}, ${enumLabel(operation.phase)}, destination ${formatCoords(operation.destination)}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div className="stack" style={{ gap: '0.2rem' }}>
          <h2 style={{ margin: 0 }}>{operationLabel(operation)}</h2>
          <span>{enumLabel(operation.phase)}</span>
        </div>
        <span className="tag">{operation.direction === 'RETURNING' ? 'Returning' : 'Outbound'}</span>
      </div>
      <dl className="research-details">
        <div><dt>Origin</dt><dd>{operation.origin.name} · {formatCoords(operation.origin.coordinates)}</dd></div>
        <div><dt>Destination</dt><dd>{formatCoords(operation.destination)}</dd></div>
        <div><dt>Departed</dt><dd>{formatDateTime(operation.departedAt)}</dd></div>
        <div><dt>{nextLabel}</dt><dd>{operation.nextEventAt ? formatDateTime(operation.nextEventAt) : 'Storage capacity required'}</dd></div>
        <div><dt>Countdown</dt><dd aria-live="polite">{formatCountdown(operation.nextEventAt, now)}</dd></div>
      </dl>
      <ManifestSummary operation={operation} />
      {operation.phase === 'AWAITING_DESTINATION_CAPACITY' ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Cargo remains safe until the destination can accept the complete shipment.</p> : null}
    </article>
  );
}

export default function OperationsPage() {
  const now = useTicker();
  const load = useCallback(() => apiGet<MissionControlResponse>('/api/operations'), []);
  const { data, loading, error, reload } = useApiData(load);
  const refreshedAtZero = useRef(new Set<string>());

  useEffect(() => {
    const due = data?.operations.filter((operation) => operation.nextEventAt && new Date(operation.nextEventAt).getTime() <= now) ?? [];
    if (due.length && due.some((operation) => !refreshedAtZero.current.has(`${operation.missionType}:${operation.origin.name}:${operation.nextEventAt}`))) {
      due.forEach((operation) => refreshedAtZero.current.add(`${operation.missionType}:${operation.origin.name}:${operation.nextEventAt}`));
      reload();
    }
  }, [data, now, reload]);

  const outbound = data?.operations.filter((operation) => operation.direction === 'OUTBOUND') ?? [];
  const returning = data?.operations.filter((operation) => operation.direction === 'RETURNING') ?? [];
  return (
    <section className="stack">
      <div className="panel stack">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div className="stack" style={{ gap: '0.25rem' }}>
            <h1 style={{ margin: 0 }}>Mission Control</h1>
            <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Read-only status for your active canonical operations. Flight, settlement, and returns remain server-authoritative.</p>
          </div>
          <div><Link className="btn" href="/game/reports">Open reports</Link></div>
        </div>
      </div>
      {loading ? <StatusPanel message="Loading active operations..." /> : null}
      {error ? <StatusPanel tone="error" title="Mission Control unavailable" message={error} /> : null}
      {!loading && !error && data?.operations.length === 0 ? <StatusPanel title="No active operations" message="Your canonical missions will appear here while they are outbound, returning, or waiting for destination capacity." /> : null}
      {!loading && !error && outbound.length > 0 ? <div className="stack"><h2 style={{ margin: 0 }}>Outbound</h2>{outbound.map((operation, index) => <OperationCard key={`${operation.missionType}-${operation.origin.name}-${operation.departedAt}-${index}`} operation={operation} now={now} />)}</div> : null}
      {!loading && !error && returning.length > 0 ? <div className="stack"><h2 style={{ margin: 0 }}>Returning</h2>{returning.map((operation, index) => <OperationCard key={`${operation.missionType}-${operation.origin.name}-${operation.departedAt}-${index}`} operation={operation} now={now} />)}</div> : null}
      {!loading && !error && !data ? <StatusPanel tone="error" title="Mission Control unavailable" message="No operation data was returned." /> : null}
    </section>
  );
}

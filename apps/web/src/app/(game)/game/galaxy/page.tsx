'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { GALAXY_COORDINATE_BOUNDS } from '@eonrover/shared';
import StatusPanel from '@/components/StatusPanel';
import { apiGet } from '@/lib/api';
import { enumLabel, formatNumber } from '@/lib/formatters';
import { useApiData } from '@/lib/useApiData';
import { useGameCommand } from '@/lib/GameCommandContext';
import { GalaxySystemResponse } from '@/lib/web-types';

export default function GalaxyPage() {
  const { summary } = useGameCommand();
  const [galaxy, setGalaxy] = useState(1);
  const [system, setSystem] = useState(1);
  const loadSystem = useCallback(
    () => apiGet<GalaxySystemResponse>(`/api/galaxy/${galaxy}/${system}`),
    [galaxy, system],
  );
  const { data, loading, error } = useApiData(loadSystem);

  return (
    <section className="stack">
      <div className="panel stack">
        <h1 style={{ margin: 0 }}>Galaxy Browser</h1>
        <div className="cta-row" style={{ justifyContent: 'flex-start' }}>
          <button type="button" onClick={() => setGalaxy((value) => Math.max(GALAXY_COORDINATE_BOUNDS.galaxy.min, value - 1))}>Galaxy -</button>
          <button type="button" onClick={() => setGalaxy((value) => Math.min(GALAXY_COORDINATE_BOUNDS.galaxy.max, value + 1))}>Galaxy +</button>
          <button type="button" onClick={() => setSystem((value) => Math.max(GALAXY_COORDINATE_BOUNDS.system.min, value - 1))}>System -</button>
          <button type="button" onClick={() => setSystem((value) => Math.min(GALAXY_COORDINATE_BOUNDS.system.max, value + 1))}>System +</button>
          <span className="tag">[{formatNumber(galaxy)}:{formatNumber(system)}]</span>
        </div>
      </div>
      {loading ? <StatusPanel message="Scanning system..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to scan system" message={error} /> : null}
      {!loading && !error && data?.slots.length === 0 ? <StatusPanel message="No slots returned for this system." /> : null}
      {!loading && !error && data ? (
        <div className="panel" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Slot</th>
                <th>Planet</th>
                <th>Owner</th>
                <th>Type</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.slots.map((slot) => (
                <tr key={slot.slot}>
                  <td>{slot.slot}</td>
                  <td>{slot.occupancy === 'public' ? slot.planet.name : slot.occupancy === 'empty' ? 'Empty' : 'Unavailable'}</td>
                  <td>{slot.occupancy === 'public' ? slot.owner.username : '—'}</td>
                  <td>{slot.occupancy === 'public' ? enumLabel(slot.planet.type) : '—'}</td>
                  <td>{slot.occupancy === 'empty' ? 'Open' : slot.occupancy === 'unavailable' ? 'Unavailable' : slot.owner.protected ? 'Protected' : 'Occupied'}</td>
                  <td>{slot.occupancy === 'public' && summary?.selectedPlanetId ? <Link className="btn" href={`/game/planets/${encodeURIComponent(summary.selectedPlanetId)}/fleet?mode=espionage&targetGalaxy=${galaxy}&targetSystem=${system}&targetSlot=${slot.slot}`} aria-label={`Send Probe to ${slot.planet.name} at ${galaxy}:${system}:${slot.slot}`}>Send Probe</Link> : slot.occupancy === 'public' ? <span className="tag">Select an origin planet first</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

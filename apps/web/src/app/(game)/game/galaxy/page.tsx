'use client';

import { useCallback, useState } from 'react';
import { GALAXY_COORDINATE_BOUNDS } from '@eonrover/shared';
import StatusPanel from '@/components/StatusPanel';
import { apiGet } from '@/lib/api';
import { enumLabel, formatNumber } from '@/lib/formatters';
import { useApiData } from '@/lib/useApiData';
import { GalaxySystemResponse } from '@/lib/web-types';

export default function GalaxyPage() {
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
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>Slot</th>
                <th>Planet</th>
                <th>Owner</th>
                <th>Type</th>
                <th>Status</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import ResourceBar from '@/components/ResourceBar';
import StatusPanel from '@/components/StatusPanel';
import { apiGet } from '@/lib/api';
import { formatCoords, formatNumber } from '@/lib/formatters';
import { useApiData } from '@/lib/useApiData';
import { PlanetSummary } from '@/lib/web-types';

export default function GameDashboardPage() {
  const loadPlanets = useCallback(() => apiGet<{ planets: PlanetSummary[] }>('/api/planets'), []);
  const { data, loading, error } = useApiData(loadPlanets);

  const totals = data?.planets.reduce(
    (sum, planet) => ({
      alloy: sum.alloy + planet.alloy,
      heliox: sum.heliox + planet.heliox,
      aether: sum.aether + planet.aether,
    }),
    { alloy: 0, heliox: 0, aether: 0 },
  );

  return (
    <section className="stack">
      <div className="panel stack">
        <h1 style={{ margin: 0 }}>Command Dashboard</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Review your colonies and jump straight into construction, research, or fleet work.</p>
      </div>
      {loading ? <StatusPanel message="Loading colonies..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load dashboard" message={error} /> : null}
      {!loading && !error && data?.planets.length === 0 ? <StatusPanel message="No planets yet. Registering should create your first homeworld automatically." /> : null}
      {!loading && !error && totals ? <ResourceBar resources={totals} /> : null}
      {!loading && !error && data?.planets.length ? (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {data.planets.map((planet) => (
            <article className="panel stack" key={planet.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                <h2 style={{ margin: 0 }}>{planet.name}</h2>
                {planet.isHomeworld ? <span className="tag">Homeworld</span> : null}
              </div>
              <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
                {formatCoords(planet)} · {planet.planetType.replace('_', ' ')} · {planet.temperature}°C
              </p>
              <div className="grid grid-cards">
                <div className="panel stack"><strong className="resource-alloy">Alloy</strong><span>{formatNumber(planet.alloy)}</span></div>
                <div className="panel stack"><strong className="resource-heliox">Heliox</strong><span>{formatNumber(planet.heliox)}</span></div>
                <div className="panel stack"><strong className="resource-aether">Aether</strong><span>{formatNumber(planet.aether)}</span></div>
              </div>
              <div className="cta-row" style={{ justifyContent: 'flex-start' }}>
                <Link href={`/game/planets/${planet.id}`} className="btn btn-primary">Overview</Link>
                <Link href={`/game/planets/${planet.id}/buildings`} className="btn">Buildings</Link>
                <Link href={`/game/planets/${planet.id}/fleet`} className="btn">Fleet</Link>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

'use client';

import { useCallback } from 'react';
import { useParams } from 'next/navigation';
import StatusPanel from '@/components/StatusPanel';
import { apiGet } from '@/lib/api';
import { enumLabel, formatNumber } from '@/lib/formatters';
import { useApiData } from '@/lib/useApiData';
import { ShipyardReadOnlyResponse } from '@/lib/web-types';

export default function ShipyardPage() {
  const { planetId } = useParams<{ planetId: string }>();
  const load = useCallback(() => apiGet<ShipyardReadOnlyResponse>(`/api/planets/${encodeURIComponent(planetId)}/shipyard`), [planetId]);
  const { data, loading, error } = useApiData(load);
  return <section className="stack">
    <div className="panel stack"><h1 style={{ margin: 0 }}>Shipyard catalogue</h1><p className="alert" role="status">Ship construction scheduling is currently unavailable.</p><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Existing ships and legacy queue rows are presented read-only while authoritative construction work is completed.</p></div>
    {loading ? <StatusPanel message="Loading authoritative Shipyard catalogue..." /> : null}
    {error ? <StatusPanel tone="error" title="Unable to load Shipyard" message={error} /> : null}
    {!loading && !error && !data ? <StatusPanel message="No Shipyard data returned." /> : null}
    {data ? <>
      <div className="panel stack"><h2 style={{ margin: 0 }}>Selected Shipyard</h2><p style={{ margin: 0 }}><strong>{data.selectedPlanet.name}</strong> · Shipyard level {data.selectedPlanet.shipyardLevel}</p><p style={{ margin: 0 }}>Resources: {formatNumber(data.selectedPlanet.resources.alloy)} Alloy · {formatNumber(data.selectedPlanet.resources.heliox)} Heliox · {formatNumber(data.selectedPlanet.resources.aether)} Aether</p></div>
      {data.legacyQueue.length ? <div className="panel stack"><h2 style={{ margin: 0 }}>Legacy queue</h2><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Read-only legacy rows; this page does not alter them.</p>{data.legacyQueue.map((item) => <p key={item.id} style={{ margin: 0 }}>{enumLabel(item.itemKey)} × {formatNumber(item.quantity)} · {item.remaining} remaining · {item.status}</p>)}</div> : null}
      <nav aria-label="Shipyard categories" className="research-category-nav"><ul>{data.categories.map((category) => <li key={category.id}><a href={`#shipyard-${category.id}`}>{category.name}</a></li>)}</ul></nav>
      {data.categories.map((category) => <section className="stack" id={`shipyard-${category.id}`} key={category.id}><h2>{category.name}</h2><div className="grid research-catalogue-grid">{data.catalog.filter((ship) => ship.category === category.id).map((ship) => <article className="panel stack" key={ship.id}><div className="research-card-heading"><h3>{ship.name}</h3><span className="tag">Owned {formatNumber(ship.owned)}</span></div><p>{ship.description}</p><dl className="research-details"><div><dt>Cost</dt><dd>{formatNumber(ship.cost.alloy)} Alloy · {formatNumber(ship.cost.heliox)} Heliox · {formatNumber(ship.cost.aether)} Aether</dd></div><div><dt>Estimated duration</dt><dd>{Math.max(1, Math.round(ship.durationSeconds / 60))} minutes</dd></div><div><dt>Statistics</dt><dd>Speed {formatNumber(ship.statistics.speed)} · Cargo {formatNumber(ship.statistics.cargo)} · Fuel {ship.statistics.fuelPerDistance} · Attack {ship.statistics.attack} · Shield {ship.statistics.shield} · Armour {formatNumber(ship.statistics.armour)}</dd></div><div><dt>Effect</dt><dd>{ship.effect.description} ({ship.effect.status})</dd></div></dl><p><strong>Intended missions:</strong> {ship.missions.join(' ')}</p><ul>{ship.requirements.map((requirement) => <li key={requirement.id}>{enumLabel(requirement.id)} level {requirement.requiredLevel}: {requirement.met ? 'met' : `current ${requirement.currentLevel}`}</li>)}</ul><p role="status">{ship.meetsRequirements ? 'Requirements met. Scheduling remains unavailable.' : 'Requirements are not met.'}</p></article>)}</div></section>)}
    </> : null}
  </section>;
}

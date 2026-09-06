'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import type { BuildingKey } from '@eonrover/shared';
import {
  projectVisualResourceAmount,
  selectPlanetNextAction,
  timeUntilStorageFullSeconds,
} from '@eonrover/shared';
import StatusPanel from '@/components/StatusPanel';
import { useGameCommand } from '@/lib/GameCommandContext';
import {
  enumLabel,
  formatCoords,
  formatDateTime,
  formatDecimal,
  formatNumber,
  formatRelativeCountdown,
} from '@/lib/formatters';
import { ResourceAmounts } from '@/lib/web-types';

const RESOURCE_META = [
  { key: 'alloy', label: 'Alloy', className: 'resource-alloy' },
  { key: 'heliox', label: 'Heliox', className: 'resource-heliox' },
  { key: 'aether', label: 'Aether', className: 'resource-aether' },
] as const;

const IMPORTANT_BUILDINGS: BuildingKey[] = [
  'alloyMine',
  'helioxExtractor',
  'aetherSynthesizer',
  'solarArray',
  'researchLab',
  'shipyard',
];

function formatTimeSpan(seconds: number): string {
  if (seconds <= 0) return 'Full now';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${Math.max(1, minutes)}m`;
}

export default function PlanetOverviewPage() {
  const params = useParams<{ planetId: string }>();
  const { summary, loading, error, now } = useGameCommand();
  const planet = summary?.selectedPlanet ?? null;
  const matchesRoute = summary?.selectedPlanetId === params.planetId;
  const serverTimestampMs = summary ? Date.parse(summary.serverTimestamp) : 0;
  const displayTimestampMs = now || serverTimestampMs;
  const buildingLevels = useMemo(
    () => Object.fromEntries((planet?.buildings ?? []).map((building) => [building.key, building.level])) as Partial<Record<BuildingKey, number>>,
    [planet?.buildings],
  );
  const recommendation = planet
    ? selectPlanetNextAction({
        activeConstruction: planet.activeConstruction,
        fields: planet.fields,
        energyStatus: planet.energy.status,
        energyBlockedBuildingKeys: planet.energyBlockedBuildingKeys,
        buildingLevels,
      })
    : null;

  if (loading && !matchesRoute) return <StatusPanel message="Loading selected planet…" />;
  if (!matchesRoute || !planet || !summary) {
    return (
      <StatusPanel
        tone="error"
        title="Planet unavailable"
        message={error ?? 'This planet could not be found among the colonies owned by this account.'}
      />
    );
  }

  const projectedResources = {} as ResourceAmounts;
  for (const resource of RESOURCE_META) {
    projectedResources[resource.key] = projectVisualResourceAmount({
      amount: planet.resources[resource.key],
      hourlyRate: planet.productionPerHour[resource.key],
      capacity: planet.storage[resource.key],
      serverTimestampMs,
      displayTimestampMs,
    });
  }
  const buildingsHref = `/game/planets/${planet.identity.id}/buildings`;
  const recommendationHref = recommendation?.kind === 'energy' ? `${buildingsHref}#energy` : buildingsHref;
  const fieldUsagePercentage = Math.min(100, Math.max(0, (planet.fields.occupied / planet.fields.capacity) * 100));

  return (
    <section className="stack planet-command-page" aria-labelledby="planet-command-heading">
      <header className="panel planet-identity-panel">
        <div className="planet-orbit-art" role="img" aria-label={`${enumLabel(planet.identity.planetType)} planet tactical rendering`}>
          <span className="planet-orbit-ring" />
          <span className="planet-orb" />
        </div>
        <div className="planet-identity-copy">
          <p className="eyebrow">Selected colony</p>
          <h1 id="planet-command-heading">{planet.identity.name}</h1>
          <p>
            {formatCoords(planet.identity.coordinates)} · {enumLabel(planet.identity.planetType)} environment
          </p>
          <dl className="planet-environment-list">
            <div><dt>Temperature</dt><dd>{planet.identity.temperature}°C</dd></div>
            <div><dt>Solar index</dt><dd>{planet.identity.solarIndex.toFixed(2)}</dd></div>
          </dl>
        </div>
        {planet.identity.isHomeworld ? <span className="tag planet-homeworld-tag">Homeworld</span> : null}
      </header>

      <section className="stack" aria-labelledby="economy-heading">
        <div className="section-heading-row">
          <div><p className="eyebrow">Authoritative economy</p><h2 id="economy-heading">Economy</h2></div>
          <small>Live display projected from {formatDateTime(summary.serverTimestamp)}</small>
        </div>
        <div className="overview-economy-grid">
          {RESOURCE_META.map(({ key, label, className }) => {
            const amount = projectedResources[key];
            const capacity = planet.storage[key];
            const rate = planet.productionPerHour[key];
            const ratio = capacity > 0 ? Math.min(100, (amount / capacity) * 100) : 0;
            const untilFull = timeUntilStorageFullSeconds(amount, rate, capacity);
            const isFull = amount >= capacity;
            return (
              <article className="panel economy-card" key={key}>
                <div className="economy-card-heading"><h3 className={className}>{label}</h3><strong>{formatDecimal(amount)}</strong></div>
                <div className="progress-bar" role="progressbar" aria-label={`${label} storage usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio)}>
                  <span style={{ width: `${ratio}%` }} />
                </div>
                <dl>
                  <div><dt>Production</dt><dd>+{formatDecimal(rate)}/h</dd></div>
                  <div><dt>Storage</dt><dd>{formatNumber(capacity)}</dd></div>
                  <div><dt>Until full</dt><dd>{untilFull === null ? 'No active production' : formatTimeSpan(untilFull)}</dd></div>
                </dl>
                {isFull ? <p className="overview-warning">Storage is full; production is capped.</p> : null}
                {!isFull && rate === 0 ? <p className="overview-note">No production building is currently active.</p> : null}
              </article>
            );
          })}
        </div>
      </section>

      <div className="overview-dashboard-grid">
        <section className={`panel stack overview-fields${planet.fields.available === 0 ? ' fields-full' : ''}`} aria-labelledby="overview-fields-heading">
          <div className="section-heading-row">
            <div><p className="eyebrow">Planetary space</p><h2 id="overview-fields-heading">Building fields</h2></div>
            <span className="tag">{planet.fields.occupied} / {planet.fields.capacity}</span>
          </div>
          <div className="field-capacity-row">
            <span>{planet.fields.completedUsed} built{planet.fields.reserved > 0 ? ` + ${planet.fields.reserved} under construction` : ''}</span>
            <strong>{planet.fields.available} remaining</strong>
          </div>
          <div className="field-capacity-bar" role="progressbar" aria-label="Planetary building fields occupied" aria-valuemin={0} aria-valuemax={planet.fields.capacity} aria-valuenow={Math.min(planet.fields.capacity, Math.max(0, planet.fields.occupied))} aria-valuetext={`${planet.fields.occupied} of ${planet.fields.capacity} fields occupied; ${planet.fields.available} remaining`}>
            <span style={{ width: `${fieldUsagePercentage}%` }} />
          </div>
          {planet.fields.isOverCapacity ? (
            <p className="overview-warning">This legacy planet is {planet.fields.overCapacityBy} fields over capacity. Existing buildings remain active, but new construction is blocked.</p>
          ) : planet.fields.available === 0 ? (
            <p className="overview-warning">Planetary field capacity is full. No new building upgrade can begin.</p>
          ) : planet.fields.available <= Math.max(1, Math.ceil(planet.fields.capacity * 0.1)) ? (
            <p className="overview-warning">Planetary fields are nearly full.</p>
          ) : (
            <p className="overview-note">Space remains available for colony development.</p>
          )}
        </section>

        <section className={`panel stack overview-energy energy-${planet.energy.status}`} aria-labelledby="overview-energy-heading">
          <div className="section-heading-row">
            <div><p className="eyebrow">Planetary grid</p><h2 id="overview-energy-heading">Energy</h2></div>
            <span className="energy-state-label">{enumLabel(planet.energy.status)}</span>
          </div>
          <div className="overview-stat-grid">
            <div><span>Supply</span><strong>{formatDecimal(planet.energy.supply)}</strong></div>
            <div><span>Demand</span><strong>{formatDecimal(planet.energy.demand)}</strong></div>
            <div><span>Available</span><strong>{formatDecimal(planet.energy.available)}</strong></div>
            <div><span>Efficiency</span><strong>{formatDecimal(planet.energy.productionEfficiency * 100)}%</strong></div>
          </div>
          <div className="energy-capacity-row"><span>Grid utilisation</span><strong>{formatDecimal(planet.energy.utilisationPercentage)}%</strong></div>
          <div className="energy-capacity-bar" role="progressbar" aria-label="Energy capacity utilisation" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, Math.round(planet.energy.utilisationPercentage)))}>
            <span style={{ width: `${Math.min(100, Math.max(0, planet.energy.utilisationPercentage))}%` }} />
          </div>
          {planet.energy.status !== 'healthy' ? (
            <p className="overview-warning">
              {planet.energy.status === 'deficit'
                ? 'Resource production is reduced until the grid returns to capacity.'
                : 'Grid capacity is low; review generation before adding more continuous demand.'}
            </p>
          ) : <p className="overview-note">The grid has healthy spare capacity.</p>}
          <Link className="btn" href={`${buildingsHref}#energy`}>Review Energy buildings</Link>
        </section>

        <section className="panel stack overview-development" aria-labelledby="development-heading">
          <div className="section-heading-row">
            <div><p className="eyebrow">Colony progress</p><h2 id="development-heading">Development</h2></div>
            <Link href={buildingsHref}>All buildings</Link>
          </div>
          <div className="building-level-list">
            {IMPORTANT_BUILDINGS.map((key) => {
              const building = planet.buildings.find((candidate) => candidate.key === key);
              return <div key={key}><span>{building?.name ?? enumLabel(key)}</span><strong>Level {building?.level ?? 0}</strong></div>;
            })}
          </div>
          {planet.activeConstruction ? (
            <div className="overview-construction">
              <strong>{planet.activeConstruction.buildingName} → level {planet.activeConstruction.targetLevel}</strong>
              <span>{formatRelativeCountdown(planet.activeConstruction.completesAt, now)} remaining</span>
              <small>Completes {formatDateTime(planet.activeConstruction.completesAt)}</small>
            </div>
          ) : <p className="overview-note">No building construction is active.</p>}
        </section>
      </div>

      {recommendation ? (
        <section className="panel next-action-panel" aria-labelledby="next-action-heading">
          <div>
            <p className="eyebrow">Recommended next action</p>
            <h2 id="next-action-heading">{recommendation.title}</h2>
            <p>{recommendation.reason}</p>
          </div>
          {recommendation.kind === 'fields' ? null : (
            <Link className="btn btn-primary" href={recommendationHref}>
              {recommendation.kind === 'construction' ? 'View construction' : 'Review buildings'}
            </Link>
          )}
        </section>
      ) : null}
    </section>
  );
}

'use client';

import { KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import StatusPanel from '@/components/StatusPanel';
import { ApiError, apiDelete, apiGet, apiPost } from '@/lib/api';
import { requestCommandSummaryRefresh } from '@/lib/GameCommandContext';
import {
  formatDateTime,
  formatDecimal,
  formatNumber,
  formatRelativeCountdown,
} from '@/lib/formatters';
import { getErrorMessage, useApiData, useTicker } from '@/lib/useApiData';
import {
  BuildingCatalogItem,
  BuildingCategory,
  BuildingCategoryMetadata,
  BuildingEnergyEffect,
  PlanetEnergySummary,
  PresentedBuildQueueItem,
  ResourceAmounts,
} from '@/lib/web-types';

interface BuildingsResponse {
  categories: BuildingCategoryMetadata[];
  catalog: BuildingCatalogItem[];
  queue: PresentedBuildQueueItem[];
  planet: ResourceAmounts & { lastProductionAt: string };
  energy: PlanetEnergySummary;
  storage: ResourceAmounts;
  production: ResourceAmounts;
}

const ENERGY_STATE_COPY: Record<PlanetEnergySummary['status'], { label: string; detail: string }> = {
  healthy: {
    label: 'Healthy spare capacity',
    detail: 'The planetary grid has room for additional continuous demand.',
  },
  approaching: {
    label: 'Approaching capacity',
    detail: 'Plan another Solar Array upgrade before adding much more demand.',
  },
  'at-capacity': {
    label: 'Exact capacity',
    detail: 'The grid is fully allocated. Add generation before another energy-consuming upgrade.',
  },
  deficit: {
    label: 'Energy deficit',
    detail: 'Resource production is reduced. Upgrade the Solar Array to restore grid capacity.',
  },
};

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', `${remainder}s`]
    .filter(Boolean)
    .join(' ');
}

function energyEffectText(effect: BuildingEnergyEffect): string {
  if (effect.kind === 'none') return 'No continuous energy demand';
  return `${effect.kind === 'supply' ? 'Generates' : 'Uses'} ${formatDecimal(effect.amount)} energy`;
}

function BuildingSchematic({ building }: { building: BuildingCatalogItem }) {
  const isEnergy = building.category === 'energy';
  const isResources = building.category === 'resources';
  return (
    <svg
      className={`building-schematic building-schematic-${building.category}`}
      viewBox="0 0 160 100"
      role="img"
      aria-label={`${building.name} planetary facility schematic`}
    >
      <title>{building.name} planetary facility schematic</title>
      <path className="schematic-horizon" d="M8 87 Q80 65 152 87" />
      {isEnergy ? (
        <>
          <circle className="schematic-orbit" cx="80" cy="27" r="15" />
          <path className="schematic-structure" d="M80 42V69M63 74h34M69 69l11-27 11 27" />
          <path className="schematic-signal" d="M48 52l22 8M112 52l-22 8M51 40l22 9M109 40l-22 9" />
        </>
      ) : isResources ? (
        <>
          <path className="schematic-structure" d="M37 76V42h22v34M66 76V29h29v47M102 76V49h20v27" />
          <path className="schematic-signal" d="M44 35l8-12 8 12M76 22l5-9 5 9M109 42l5-8 5 8" />
          <circle className="schematic-orbit" cx="80" cy="52" r="6" />
        </>
      ) : (
        <>
          <path className="schematic-structure" d="M35 76l10-37h70l10 37M52 76V51h56v25M71 76V58h18v18" />
          <path className="schematic-signal" d="M80 39V20M68 29l12-9 12 9" />
          <circle className="schematic-orbit" cx="80" cy="20" r="4" />
        </>
      )}
    </svg>
  );
}

function resourceShortfallText(building: BuildingCatalogItem): string | null {
  const missing = (Object.entries(building.missingResources) as Array<[keyof ResourceAmounts, number]>)
    .filter(([, amount]) => amount > 0)
    .map(([resource, amount]) => `${formatNumber(amount)} more ${resource}`);
  return missing.length > 0 ? `Needs ${missing.join(', ')}.` : null;
}

export default function BuildingsPage() {
  const params = useParams<{ planetId: string }>();
  const planetId = params.planetId;
  const now = useTicker();
  const [activeCategory, setActiveCategory] = useState<BuildingCategory>('resources');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const refreshedDueConstruction = useRef<string | null>(null);

  const loadBuildings = useCallback(
    () => apiGet<BuildingsResponse>(`/api/planets/${planetId}/buildings`),
    [planetId],
  );
  const { data, loading, error, reload } = useApiData(loadBuildings);
  const actionPending = busyKey !== null;
  const dueConstruction = data?.queue.find((item) => new Date(item.completesAt).getTime() <= now);

  useEffect(() => {
    if (window.location.hash === '#energy') setActiveCategory('energy');
  }, []);

  useEffect(() => {
    if (!dueConstruction) {
      refreshedDueConstruction.current = null;
      return;
    }
    if (refreshedDueConstruction.current === dueConstruction.id) return;
    refreshedDueConstruction.current = dueConstruction.id;
    reload();
  }, [dueConstruction, reload]);

  useEffect(() => {
    if (data && !data.categories.some((category) => category.key === activeCategory)) {
      setActiveCategory(data.categories[0]?.key ?? 'resources');
    }
  }, [activeCategory, data]);

  async function enqueue(key: string) {
    setBusyKey(key);
    setActionError(null);
    try {
      await apiPost(`/api/planets/${planetId}/buildings`, { key });
      requestCommandSummaryRefresh();
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INSUFFICIENT_ENERGY') {
        setActionError('The grid no longer has enough capacity. Upgrade the Solar Array and try again.');
        setActiveCategory('energy');
      } else {
        setActionError(getErrorMessage(err));
      }
      reload();
    } finally {
      setBusyKey(null);
    }
  }

  async function cancelQueue(queueItemId: string) {
    setBusyKey(queueItemId);
    setActionError(null);
    try {
      await apiDelete(`/api/planets/${planetId}/buildings/${queueItemId}`);
      requestCommandSummaryRefresh();
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  function selectCategory(category: BuildingCategory) {
    setActiveCategory(category);
    document.getElementById('building-category-panel')?.scrollIntoView({ block: 'nearest' });
  }

  function revealPrerequisite(buildingId: string) {
    const prerequisite = data?.catalog.find((building) => building.id === buildingId);
    if (!prerequisite) return;
    setActiveCategory(prerequisite.category);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const card = document.getElementById(`building-card-${buildingId}`);
        card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        card?.focus({ preventScroll: true });
      });
    });
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabList = event.currentTarget.closest('[role="tablist"]');
    const tabs = Array.from(tabList?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const currentIndex = tabs.indexOf(event.currentTarget);
    if (currentIndex < 0 || tabs.length === 0) return;
    event.preventDefault();
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[nextIndex].focus();
    selectCategory(tabs[nextIndex].dataset.category as BuildingCategory);
  }

  const energyCopy = data ? ENERGY_STATE_COPY[data.energy.status] : null;
  const visibleBuildings = data?.catalog.filter((building) => building.category === activeCategory) ?? [];

  return (
    <section className="stack buildings-page" aria-labelledby="buildings-heading">
      <header className="panel buildings-heading">
        <div>
          <p className="eyebrow">Planetary development</p>
          <h1 id="buildings-heading">Buildings</h1>
          <p>Shape the colony grid, expand resource output and coordinate one durable upgrade at a time.</p>
        </div>
      </header>
      {loading ? <StatusPanel message="Loading building catalog..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load buildings" message={error} /> : null}
      {actionError ? <StatusPanel tone="error" title="Build action failed" message={actionError} /> : null}
      {!loading && !error && !data ? <StatusPanel message="No building data returned." /> : null}
      {!loading && !error && data && energyCopy ? (
        <>
          <section className={`panel stack energy-summary energy-${data.energy.status}`} aria-labelledby="energy-heading">
            <div className="energy-summary-heading">
              <div>
                <p className="eyebrow">Planetary grid</p>
                <h2 id="energy-heading">Energy capacity</h2>
              </div>
              <span className="energy-state-label">{energyCopy.label}</span>
            </div>
            <div className="energy-metrics">
              <div><span>Supply</span><strong>{formatDecimal(data.energy.supply)}</strong></div>
              <div><span>Demand</span><strong>{formatDecimal(data.energy.demand)}</strong></div>
              <div><span>{data.energy.available < 0 ? 'Deficit' : 'Available'}</span><strong>{formatDecimal(Math.abs(data.energy.available))}</strong></div>
              <div><span>Production efficiency</span><strong>{formatDecimal(data.energy.productionEfficiency * 100)}%</strong></div>
            </div>
            <div className="energy-capacity-row">
              <span id="energy-capacity-label">Capacity utilisation</span>
              <strong>{formatDecimal(data.energy.utilisationPercentage)}%</strong>
            </div>
            <div
              className="energy-capacity-bar"
              role="progressbar"
              aria-labelledby="energy-capacity-label"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, Math.max(0, Math.round(data.energy.utilisationPercentage)))}
              aria-valuetext={`${formatDecimal(data.energy.utilisationPercentage)} percent utilised; ${energyCopy.label}`}
            >
              <span style={{ width: `${Math.min(100, Math.max(0, data.energy.utilisationPercentage))}%` }} />
            </div>
            <p className="energy-guidance">{energyCopy.detail}</p>
          </section>

          <section className="panel stack active-construction" aria-labelledby="construction-heading">
            <div className="active-construction-heading">
              <div>
                <p className="eyebrow">Authoritative queue</p>
                <h2 id="construction-heading">Active construction</h2>
              </div>
              <span className="tag">{data.queue.length > 0 ? 'In progress' : 'Queue clear'}</span>
            </div>
            {data.queue.length === 0 ? (
              <p className="muted-copy">No building upgrade is active. Choose a facility below to begin.</p>
            ) : null}
            {data.queue.map((item) => (
              <div key={item.id} className="construction-card">
                <div className="stack" style={{ gap: '0.4rem' }}>
                  <strong>{item.buildingName} → level {item.targetLevel}</strong>
                  <span>Completes {formatDateTime(item.completesAt)}</span>
                  <span className="construction-countdown" aria-live="polite">
                    {formatRelativeCountdown(item.completesAt, now)} remaining
                  </span>
                  <small className="muted-copy">
                    Cancellation returns {item.cancellation.refundPercentage}%: {formatNumber(item.cancellation.refund.alloy)} Alloy,{' '}
                    {formatNumber(item.cancellation.refund.heliox)} Heliox, {formatNumber(item.cancellation.refund.aether)} Aether.
                  </small>
                </div>
                <button type="button" onClick={() => cancelQueue(item.id)} disabled={actionPending}>
                  {busyKey === item.id ? 'Cancelling...' : 'Cancel upgrade'}
                </button>
              </div>
            ))}
          </section>

          <nav className="building-category-nav" aria-label="Building categories">
            <div role="tablist" aria-label="Building categories">
              {data.categories.map((category) => (
                <button
                  key={category.key}
                  type="button"
                  role="tab"
                  id={`building-tab-${category.key}`}
                  aria-selected={activeCategory === category.key}
                  aria-controls="building-category-panel"
                  tabIndex={activeCategory === category.key ? 0 : -1}
                  data-category={category.key}
                  onClick={() => selectCategory(category.key)}
                  onKeyDown={handleTabKey}
                >
                  {category.label}
                  <span>{data.catalog.filter((building) => building.category === category.key).length}</span>
                </button>
              ))}
            </div>
          </nav>

          <section
            id="building-category-panel"
            className="stack"
            role="tabpanel"
            aria-labelledby={`building-tab-${activeCategory}`}
            tabIndex={0}
          >
            <div className="category-intro">
              <div>
                <p className="eyebrow">Facility catalogue</p>
                <h2>{data.categories.find((category) => category.key === activeCategory)?.label}</h2>
              </div>
              <p>{data.categories.find((category) => category.key === activeCategory)?.description}</p>
            </div>
            <div className="building-grid">
              {visibleBuildings.map((building) => {
                const unavailableText =
                  building.unavailableReasonCode === 'INSUFFICIENT_RESOURCES'
                    ? resourceShortfallText(building) ?? building.unavailableReason
                    : building.unavailableReason;
                return (
                  <article
                    className={`panel building-card${building.meetsPrerequisites ? '' : ' building-card-locked'}`}
                    id={`building-card-${building.id}`}
                    key={building.id}
                    tabIndex={-1}
                  >
                    <BuildingSchematic building={building} />
                    <div className="building-card-title">
                      <div>
                        <span className="building-category-label">
                          {data.categories.find((category) => category.key === building.category)?.label}
                        </span>
                        <h3>{building.name}</h3>
                      </div>
                      <span className="tag">Level {building.currentLevel}</span>
                    </div>
                    <p className="building-description">{building.description}</p>
                    <dl className="building-details">
                      <div>
                        <dt>Next benefit</dt>
                        <dd>{building.effect.label}: {formatDecimal(building.effect.current)} → {formatDecimal(building.effect.next)} {building.effect.unit}</dd>
                      </div>
                      <div>
                        <dt>Energy effect</dt>
                        <dd>{energyEffectText(building.energyEffect.current)} → {energyEffectText(building.energyEffect.next)}</dd>
                      </div>
                      <div>
                        <dt>Upgrade duration</dt>
                        <dd>{formatDuration(building.constructionDurationSeconds)}</dd>
                      </div>
                    </dl>
                    <div className="building-costs" aria-label={`Upgrade cost for ${building.name}`}>
                      <span className="resource-alloy">{formatNumber(building.upgradeCost.alloy)} Alloy</span>
                      <span className="resource-heliox">{formatNumber(building.upgradeCost.heliox)} Heliox</span>
                      <span className="resource-aether">{formatNumber(building.upgradeCost.aether)} Aether</span>
                    </div>
                    {building.requirements.length > 0 ? (
                      <section
                        className={`building-prerequisites${building.meetsPrerequisites ? ' prerequisites-complete' : ' prerequisites-locked'}`}
                        aria-label={`Prerequisites for ${building.name}`}
                      >
                        <h4>{building.meetsPrerequisites ? 'Prerequisites complete' : 'Prerequisites required'}</h4>
                        <ul>
                          {building.requirements.map((requirement) => (
                            <li className={requirement.met ? 'prerequisite-met' : 'prerequisite-unmet'} key={requirement.buildingId}>
                              <span className="prerequisite-status">{requirement.met ? 'Complete' : 'Not met'}</span>
                              <button type="button" onClick={() => revealPrerequisite(requirement.buildingId)}>
                                {requirement.buildingName} level {requirement.requiredLevel}
                              </button>
                              <small>Current level: {requirement.currentLevel}</small>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}
                    {unavailableText ? (
                      <p className="building-unavailable" role="status">{unavailableText}</p>
                    ) : (
                      <p className="building-available">Ready for construction.</p>
                    )}
                    {building.unavailableReasonCode === 'INSUFFICIENT_ENERGY' ? (
                      <button type="button" className="energy-action" onClick={() => selectCategory('energy')}>
                        View energy facilities
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => enqueue(building.key)}
                      disabled={actionPending || !building.canConstruct}
                      aria-describedby={unavailableText ? `building-reason-${building.id}` : undefined}
                    >
                      {busyKey === building.key
                        ? 'Queueing...'
                        : !building.meetsPrerequisites
                          ? 'Locked: prerequisites required'
                          : `Upgrade to level ${building.nextLevel}`}
                    </button>
                    {unavailableText ? (
                      <span id={`building-reason-${building.id}`} className="visually-hidden">{unavailableText}</span>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}

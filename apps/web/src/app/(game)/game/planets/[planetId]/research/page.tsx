'use client';

import { useCallback } from 'react';
import { useParams } from 'next/navigation';
import StatusPanel from '@/components/StatusPanel';
import { apiGet } from '@/lib/api';
import { formatNumber, formatRelativeCountdown } from '@/lib/formatters';
import { useApiData, useTicker } from '@/lib/useApiData';
import { ResearchCatalogueResponse } from '@/lib/web-types';

function durationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} minutes` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default function ResearchPage() {
  const params = useParams<{ planetId: string }>();
  const planetId = params.planetId;
  const now = useTicker();
  const loadResearch = useCallback(() => apiGet<ResearchCatalogueResponse>(`/api/research?planetId=${encodeURIComponent(planetId)}`), [planetId]);
  const { data, loading, error } = useApiData(loadResearch);

  return (
    <section className="stack">
      <div className="panel stack"><h1 style={{ margin: 0 }}>Research catalogue</h1><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Technology levels apply across your account. Scheduling is not yet available.</p></div>
      {loading ? <StatusPanel message="Loading research catalogue..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load research catalogue" message={error} /> : null}
      {!loading && !error && !data ? <StatusPanel message="No research data returned." /> : null}
      {!loading && !error && data ? <>
        <div className="panel stack"><h2 style={{ margin: 0 }}>Selected laboratory</h2><p style={{ margin: 0 }}><strong>{data.selectedPlanet.name}</strong> · Research Lab level {data.selectedPlanet.researchLabLevel}</p><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Available resources: {formatNumber(data.selectedPlanet.resources.alloy)} Alloy, {formatNumber(data.selectedPlanet.resources.heliox)} Heliox, {formatNumber(data.selectedPlanet.resources.aether)} Aether.</p></div>
        <div className="panel stack"><h2 style={{ margin: 0 }}>Active research</h2>{data.activeResearch ? <p style={{ margin: 0 }}><strong>{data.activeResearch.name} → level {data.activeResearch.targetLevel}</strong> · completes in {formatRelativeCountdown(data.activeResearch.completesAt, now)}</p> : <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No active prototype research was found.</p>}<p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Research scheduling is currently unavailable.</p></div>
        <nav aria-label="Research categories" className="research-category-nav"><ul>{data.categories.map((category) => <li key={category.id}><a href={`#research-${category.id}`}>{category.name}</a></li>)}</ul></nav>
        {data.categories.map((category) => {
          const entries = data.catalog.filter((entry) => entry.category === category.id);
          return entries.length ? <section className="stack" id={`research-${category.id}`} key={category.id} aria-labelledby={`research-heading-${category.id}`}>
            <h2 id={`research-heading-${category.id}`} style={{ margin: 0 }}>{category.name}</h2>
            <div className="grid research-catalogue-grid">{entries.map((research) => <article className="panel stack" key={research.id}>
              <div className="research-card-heading"><h3 style={{ margin: 0 }}>{research.name}</h3><span className="tag">Level {research.currentLevel}</span></div>
              <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>{research.description}</p>
              <dl className="research-details"><div><dt>Next level</dt><dd>{research.nextLevel}</dd></div><div><dt>Cost</dt><dd>{formatNumber(research.cost.alloy)} Alloy · {formatNumber(research.cost.heliox)} Heliox · {formatNumber(research.cost.aether)} Aether</dd></div><div><dt>Duration</dt><dd>{durationLabel(research.durationSeconds)}</dd></div><div><dt>Effect</dt><dd>{research.effect.description} <span className="tag">{research.effect.status}</span></dd></div></dl>
              <div><strong>Requirements</strong>{research.requirements.length === 0 ? <p>None.</p> : <ul>{research.requirements.map((requirement) => <li key={`${requirement.type}-${requirement.id}`}>{requirement.name} level {requirement.requiredLevel} (current {requirement.currentLevel}) — {requirement.met ? 'Met' : 'Not met'}</li>)}</ul>}</div>
              {!research.meetsRequirements ? <p role="status" style={{ margin: 0 }}>Locked: meet the listed building or technology requirements first.</p> : null}
              {!research.affordable ? <p role="status" style={{ margin: 0 }}>Resources are currently below this next level’s cost.</p> : null}
              <p role="status" style={{ margin: 0, color: 'var(--color-text-muted)' }}>{research.scheduling.reason}</p>
            </article>)}</div>
          </section> : null;
        })}
      </> : null}
    </section>
  );
}

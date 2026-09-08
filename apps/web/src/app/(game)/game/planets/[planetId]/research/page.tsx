'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import StatusPanel from '@/components/StatusPanel';
import { ApiError, apiDelete, apiGet, apiPost } from '@/lib/api';
import { formatCoords, formatDateTime, formatNumber, formatRelativeCountdown } from '@/lib/formatters';
import { requestCommandSummaryRefresh, useGameCommand } from '@/lib/GameCommandContext';
import { getErrorMessage, useApiData, useTicker } from '@/lib/useApiData';
import { ResearchCatalogueResponse } from '@/lib/web-types';

const duration = (seconds: number) => seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)} minutes`;

export default function ResearchPage() {
  const { planetId } = useParams<{ planetId: string }>();
  const now = useTicker();
  const { refresh: refreshCommand } = useGameCommand();
  const load = useCallback(() => apiGet<ResearchCatalogueResponse>(`/api/research?planetId=${encodeURIComponent(planetId)}`), [planetId]);
  const { data, loading, error, reload } = useApiData(load);
  const [starting, setStarting] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = data?.activeResearch;
  const due = Boolean(active && now >= Date.parse(active.completesAt));

  useEffect(() => {
    if (!due) return;
    const timer = window.setTimeout(() => { void reload(); refreshCommand(); }, 1_000);
    return () => window.clearTimeout(timer);
  }, [due, reload, refreshCommand]);

  async function start(key: string) {
    setStarting(key); setMessage(null);
    try {
      const accepted = await apiPost<{ queueItem: { technologyName: string }; scheduling: string }>('/api/research', { key, planetId });
      setMessage(`${accepted.queueItem.technologyName} was accepted. ${accepted.scheduling === 'scheduled' ? 'Completion is scheduled.' : 'Completion will be recovered automatically.'}`);
      await reload(); refreshCommand(); requestCommandSummaryRefresh();
    } catch (failure) { setMessage(getErrorMessage(failure)); } finally { setStarting(null); }
  }
  async function cancel() {
    if (!active) return;
    setCancelling(true); setMessage(null);
    try {
      await apiDelete(`/api/research/${encodeURIComponent(active.queueItemId)}`);
      setMessage('Research cancelled. The exact accepted 50% snapshot refund was returned to the originating planet.');
    } catch (failure) { setMessage(failure instanceof ApiError && failure.code === 'RESEARCH_NOT_CANCELLABLE' ? 'Research is completing and can no longer be cancelled.' : getErrorMessage(failure)); }
    finally { setCancelling(false); setConfirming(false); await reload(); refreshCommand(); requestCommandSummaryRefresh(); }
  }
  return <section className="stack">
    <div className="panel stack"><h1 style={{ margin: 0 }}>Research command</h1><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>The selected planet pays resources and supplies its Research Lab. Completed technology and one active queue apply account-wide.</p></div>
    {loading ? <StatusPanel message="Loading authoritative research state..." /> : null}
    {error && !data ? <StatusPanel tone="error" title="Research unavailable" message={error} /> : null}
    {message ? <p className="alert" role="status">{message}</p> : null}
    {data ? <>
      <div className="panel stack"><h2 style={{ margin: 0 }}>Selected laboratory</h2><p style={{ margin: 0 }}><strong>{data.selectedPlanet.name}</strong> · Research Lab level {data.selectedPlanet.researchLabLevel}</p><p style={{ margin: 0 }}>Available: {formatNumber(data.selectedPlanet.resources.alloy)} Alloy · {formatNumber(data.selectedPlanet.resources.heliox)} Heliox · {formatNumber(data.selectedPlanet.resources.aether)} Aether.</p></div>
      <div className="panel stack" aria-live="polite"><h2 style={{ margin: 0 }}>Account-wide research</h2>{active ? <><p style={{ margin: 0 }}><strong>{active.name} → level {active.targetLevel}</strong> · {active.status}</p><p style={{ margin: 0 }}>Origin: {active.originatingPlanet.name} {formatCoords(active.originatingPlanet)} · completes {formatDateTime(active.completesAt)}</p><p style={{ margin: 0 }}>{due ? 'Confirming completion with the server…' : `${formatRelativeCountdown(active.completesAt, now)} remaining`}</p>{!due && (confirming ? <div className="stack" role="alertdialog" aria-label="Confirm research cancellation"><p>Cancel this research? Refund: {formatNumber(active.cancellation.refund.alloy)} Alloy · {formatNumber(active.cancellation.refund.heliox)} Heliox · {formatNumber(active.cancellation.refund.aether)} Aether to {active.originatingPlanet.name}.</p><div className="button-row"><button type="button" onClick={cancel} disabled={cancelling}>{cancelling ? 'Cancelling…' : 'Confirm cancellation'}</button><button type="button" onClick={() => setConfirming(false)}>Keep research</button></div></div> : <button type="button" onClick={() => setConfirming(true)}>Cancel research</button>)}</> : <p style={{ margin: 0 }}>No active research. Only one item may run across your account.</p>}</div>
      <nav aria-label="Research categories" className="research-category-nav"><ul>{data.categories.map((category) => <li key={category.id}><a href={`#research-${category.id}`}>{category.name}</a></li>)}</ul></nav>
      {data.categories.map((category) => { const entries = data.catalog.filter((entry) => entry.category === category.id); return entries.length ? <section className="stack" id={`research-${category.id}`} key={category.id}><h2>{category.name}</h2><div className="grid research-catalogue-grid">{entries.map((research) => { const unavailable = Boolean(active) || !research.scheduling.available; const reason = research.effect.status === 'PLANNED' ? 'Effect not yet available. This technology cannot currently be scheduled.' : active ? 'Another account-wide research item is active.' : research.scheduling.reason; return <article className="panel stack" key={research.id}><div className="research-card-heading"><h3>{research.name}</h3><span className="tag">Level {research.currentLevel} → {research.nextLevel}</span></div><p>{research.description}</p><dl className="research-details"><div><dt>Cost</dt><dd>{formatNumber(research.cost.alloy)} Alloy · {formatNumber(research.cost.heliox)} Heliox · {formatNumber(research.cost.aether)} Aether</dd></div><div><dt>Duration</dt><dd>{duration(research.durationSeconds)}</dd></div><div><dt>Effect</dt><dd>{research.effect.description} ({research.effect.status})</dd></div></dl><ul>{research.requirements.map((item) => <li key={`${item.type}-${item.id}`}>{item.name} level {item.requiredLevel}: {item.met ? ' met' : ` current ${item.currentLevel}`}</li>)}</ul><p role="status">{reason}</p><button type="button" disabled={unavailable || starting !== null} onClick={() => start(research.id)}>{starting === research.id ? 'Starting…' : research.effect.status === 'PLANNED' ? 'Effect not yet available' : unavailable ? 'Unavailable' : 'Start research'}</button></article>; })}</div></section> : null; })}
    </> : null}
  </section>;
}

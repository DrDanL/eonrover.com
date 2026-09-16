'use client';

import { useCallback, useState } from 'react';
import StatusPanel from '@/components/StatusPanel';
import { ApiError, apiGet } from '@/lib/api';
import { enumLabel, formatCoords, formatDateTime, formatNumber } from '@/lib/formatters';
import { getErrorMessage, useApiData } from '@/lib/useApiData';
import {
  CorvetteStrikeReportDetail,
  CorvetteStrikeReportListItem,
  CorvetteStrikeReportsResponse,
  EspionageProbeReportDetail,
  EspionageProbeReportListItem,
  EspionageProbeReportsResponse,
  FrigateStrikeReportDetail,
  FrigateStrikeReportListItem,
  FrigateStrikeReportsResponse,
} from '@/lib/web-types';

function reportAccessError(error: unknown, missing = false): Error {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return new Error('You do not have permission to view Probe Intelligence reports.');
  }
  if (missing && error instanceof ApiError && error.status === 404) {
    return new Error('This intelligence report is not available.');
  }
  return error instanceof Error ? error : new Error(getErrorMessage(error));
}

function QuantitySection({ title, quantities }: { title: string; quantities: Record<string, number> }) {
  const entries = Object.entries(quantities);
  if (entries.length === 0) return null;
  const headingId = `probe-${title.toLowerCase().replace(/\s+/g, '-')}-heading`;
  return (
    <section className="panel stack" aria-labelledby={headingId}>
      <h3 id={headingId} style={{ margin: 0 }}>{title}</h3>
      <dl className="research-details">
        {entries.map(([key, amount]) => <div key={key}><dt>{enumLabel(key)}</dt><dd>{formatNumber(amount)}</dd></div>)}
      </dl>
    </section>
  );
}

function ReportListItem({ report, selected, onSelect }: {
  report: EspionageProbeReportListItem;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <article className="panel stack">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <strong>{formatCoords(report.target)}</strong>
        <span className="tag">{enumLabel(report.tier)}</span>
      </div>
      <p style={{ margin: 0 }}>{report.target.planet.name} · {enumLabel(report.target.planet.type)}</p>
      <span style={{ color: 'var(--color-text-muted)' }}>Captured {formatDateTime(report.createdAt)}</span>
      <div><button type="button" className="btn" aria-pressed={selected} onClick={() => onSelect(report.id)}>View intelligence</button></div>
    </article>
  );
}

function ReportDetail({ report, onReturn }: { report: EspionageProbeReportDetail; onReturn: () => void }) {
  const { intelligence } = report;
  return (
    <div className="stack" aria-live="polite">
      <div className="panel stack">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div className="stack" style={{ gap: '0.25rem' }}>
            <h2 style={{ margin: 0 }}>Probe Intelligence</h2>
            <span style={{ color: 'var(--color-text-muted)' }}>Captured {formatDateTime(report.createdAt)} · {enumLabel(report.tier)}</span>
          </div>
          <div><button type="button" onClick={onReturn}>Back to report list</button></div>
        </div>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>This is an immutable intelligence snapshot captured when the Probe scanned the target.</p>
      </div>
      <section className="panel stack" aria-labelledby="probe-identity-heading">
        <h3 id="probe-identity-heading" style={{ margin: 0 }}>Identity</h3>
        <dl className="research-details">
          <div><dt>Coordinates</dt><dd>{formatCoords(intelligence.target.coordinates)}</dd></div>
          <div><dt>Planet</dt><dd>{intelligence.target.planetName}</dd></div>
          <div><dt>Type</dt><dd>{enumLabel(intelligence.target.planetType)}</dd></div>
          <div><dt>Observed owner</dt><dd>{intelligence.target.ownerUsername}</dd></div>
        </dl>
      </section>
      {intelligence.resources ? <section className="panel stack" aria-labelledby="probe-resources-heading">
        <h3 id="probe-resources-heading" style={{ margin: 0 }}>Resources</h3>
        <dl className="research-details">
          <div><dt>Alloy</dt><dd>{formatNumber(intelligence.resources.alloy)}</dd></div>
          <div><dt>Heliox</dt><dd>{formatNumber(intelligence.resources.heliox)}</dd></div>
          <div><dt>Aether</dt><dd>{formatNumber(intelligence.resources.aether)}</dd></div>
        </dl>
      </section> : null}
      {intelligence.buildings ? <QuantitySection title="Buildings" quantities={intelligence.buildings} /> : null}
      {intelligence.ships ? <QuantitySection title="Ships" quantities={intelligence.ships} /> : null}
      {intelligence.defences ? <QuantitySection title="Defences" quantities={intelligence.defences} /> : null}
    </div>
  );
}

function combatReportAccessError(error: unknown, missing = false): Error {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return new Error('You do not have permission to view Combat Results.');
  }
  if (missing && error instanceof ApiError && error.status === 404) {
    return new Error('This combat result is not available.');
  }
  return error instanceof Error ? error : new Error(getErrorMessage(error));
}

function CombatQuantitySection({ title, quantities }: { title: string; quantities: Record<string, number> }) {
  const entries = Object.entries(quantities);
  if (entries.length === 0) return <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>None</p>;
  return <section className="panel stack">
    <h4 style={{ margin: 0 }}>{title}</h4>
    <dl className="research-details">
      {entries.map(([key, amount]) => <div key={key}><dt>{enumLabel(key)}</dt><dd>{formatNumber(amount)}</dd></div>)}
    </dl>
  </section>;
}

function CombatReportListItem({ report, selected, onSelect }: {
  report: CorvetteStrikeReportListItem;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return <article className="panel stack">
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
      <strong>{formatCoords(report.target)}</strong>
      <span className="tag">{enumLabel(report.outcome)}</span>
    </div>
    <p style={{ margin: 0 }}>{report.target.planet.name} · {enumLabel(report.target.planet.type)}</p>
    <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Corvettes: {formatNumber(report.attacker.startingCorvettes)} sent, {formatNumber(report.attacker.lostCorvettes)} lost, {formatNumber(report.attacker.survivingCorvettes)} surviving. Defender units: {formatNumber(report.defender.survivingUnits)} surviving.</p>
    <span style={{ color: 'var(--color-text-muted)' }}>Resolved {formatDateTime(report.createdAt)}</span>
    <div><button type="button" className="btn" aria-pressed={selected} onClick={() => onSelect(report.id)}>View combat result</button></div>
  </article>;
}

function CombatReportDetail({ report, onReturn }: { report: CorvetteStrikeReportDetail; onReturn: () => void }) {
  return <div className="stack" aria-live="polite">
    <div className="panel stack">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div className="stack" style={{ gap: '0.25rem' }}>
          <h2 style={{ margin: 0 }}>Combat Result</h2>
          <span style={{ color: 'var(--color-text-muted)' }}>Resolved {formatDateTime(report.createdAt)} · {enumLabel(report.outcome)}</span>
        </div>
        <div><button type="button" onClick={onReturn}>Back to combat results</button></div>
      </div>
      <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>This is an immutable battle snapshot captured at strike arrival. It does not reflect live target state.</p>
    </div>
    <section className="panel stack">
      <h3 style={{ margin: 0 }}>Target</h3>
      <dl className="research-details">
        <div><dt>Coordinates</dt><dd>{formatCoords(report.target)}</dd></div>
        <div><dt>Planet</dt><dd>{report.target.planet.name}</dd></div>
        <div><dt>Type</dt><dd>{enumLabel(report.target.planet.type)}</dd></div>
      </dl>
    </section>
    <section className="panel stack">
      <h3 style={{ margin: 0 }}>Attacker Corvettes</h3>
      <dl className="research-details">
        <div><dt>Sent</dt><dd>{formatNumber(report.attacker.startingCorvettes)}</dd></div>
        <div><dt>Lost</dt><dd>{formatNumber(report.attacker.lostCorvettes)}</dd></div>
        <div><dt>Surviving</dt><dd>{formatNumber(report.attacker.survivingCorvettes)}</dd></div>
      </dl>
    </section>
    <section className="stack" aria-label="Defender forces">
      <h3 style={{ margin: 0 }}>Defender forces</h3>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div className="stack"><CombatQuantitySection title="Combat ships at start" quantities={report.defender.ships.starting} /><CombatQuantitySection title="Combat ships lost" quantities={report.defender.ships.lost} /><CombatQuantitySection title="Combat ships surviving" quantities={report.defender.ships.surviving} /></div>
        <div className="stack"><CombatQuantitySection title="Defences at start" quantities={report.defender.defences.starting} /><CombatQuantitySection title="Defences lost" quantities={report.defender.defences.lost} /><CombatQuantitySection title="Defences surviving" quantities={report.defender.defences.surviving} /></div>
      </div>
    </section>
    <section className="panel stack">
      <h3 style={{ margin: 0 }}>Rounds</h3>
      {report.rounds.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No combat rounds were required.</p> : <ol className="stack" style={{ margin: 0, paddingInlineStart: '1.5rem' }}>
        {report.rounds.map((round) => <li key={round.round}>Round {round.round}: attacker lost {formatNumber(round.attackerLostCorvettes)} Corvette{round.attackerLostCorvettes === 1 ? '' : 's'}; defender lost {formatNumber(round.defenderLostUnits)} unit{round.defenderLostUnits === 1 ? '' : 's'}.</li>)}
      </ol>}
    </section>
  </div>;
}

function frigateReportAccessError(error: unknown, missing = false): Error {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return new Error('You do not have permission to view Frigate Strike Results.');
  }
  if (missing && error instanceof ApiError && error.status === 404) {
    return new Error('This Frigate strike result is not available.');
  }
  return error instanceof Error ? error : new Error(getErrorMessage(error));
}

function frigateOutcomeSummary(outcome: FrigateStrikeReportListItem['outcome']): string {
  switch (outcome) {
    case 'attacker': return 'Attacker victory recorded in the immutable result.';
    case 'defender': return 'Defender victory recorded in the immutable result.';
    case 'draw': return 'No decisive winner was recorded in the immutable result.';
    case 'unresolved': return 'The immutable result recorded no final winner.';
  }
}

function FrigateCombatReportListItem({ report, selected, onSelect }: {
  report: FrigateStrikeReportListItem;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return <article className="panel stack">
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
      <strong>Frigate Strike · {formatCoords(report.target)}</strong>
      <span className="tag">{enumLabel(report.outcome)}</span>
    </div>
    <p style={{ margin: 0 }}>{report.target.planet.name} · {enumLabel(report.target.planet.type)}</p>
    <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Frigates: {formatNumber(report.attacker.startingFrigates)} sent, {formatNumber(report.attacker.lostFrigates)} lost, {formatNumber(report.attacker.survivingFrigates)} surviving. Defender units: {formatNumber(report.defender.survivingUnits)} surviving.</p>
    <p style={{ margin: 0 }} role="status">{frigateOutcomeSummary(report.outcome)}</p>
    <span style={{ color: 'var(--color-text-muted)' }}>Completed {formatDateTime(report.createdAt)}</span>
    <div><button type="button" className="btn" aria-pressed={selected} onClick={() => onSelect(report.id)}>View Frigate result</button></div>
  </article>;
}

function FrigateCombatReportDetail({ report, onReturn }: { report: FrigateStrikeReportDetail; onReturn: () => void }) {
  return <div className="stack" aria-live="polite" aria-label="Selected Frigate Strike result">
    <div className="panel stack">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div className="stack" style={{ gap: '0.25rem' }}>
          <h2 style={{ margin: 0 }}>Frigate Strike Result</h2>
          <span style={{ color: 'var(--color-text-muted)' }}>Completed {formatDateTime(report.createdAt)} · {enumLabel(report.outcome)}</span>
        </div>
        <div><button type="button" onClick={onReturn}>Back to Frigate results</button></div>
      </div>
      <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>This is an immutable battle snapshot captured at strike arrival. It does not reflect live target state, cargo, loot, debris, repairs, or later combat changes.</p>
      <p style={{ margin: 0 }} role="status">{frigateOutcomeSummary(report.outcome)}</p>
    </div>
    <section className="panel stack">
      <h3 style={{ margin: 0 }}>Target</h3>
      <dl className="research-details">
        <div><dt>Coordinates</dt><dd>{formatCoords(report.target)}</dd></div>
        <div><dt>Planet</dt><dd>{report.target.planet.name}</dd></div>
        <div><dt>Type</dt><dd>{enumLabel(report.target.planet.type)}</dd></div>
      </dl>
    </section>
    <section className="panel stack">
      <h3 style={{ margin: 0 }}>Attacker Frigates</h3>
      <dl className="research-details">
        <div><dt>Starting</dt><dd>{formatNumber(report.attacker.startingFrigates)}</dd></div>
        <div><dt>Lost</dt><dd>{formatNumber(report.attacker.lostFrigates)}</dd></div>
        <div><dt>Surviving</dt><dd>{formatNumber(report.attacker.survivingFrigates)}</dd></div>
      </dl>
    </section>
    <section className="stack" aria-label="Immutable defender forces">
      <h3 style={{ margin: 0 }}>Defender forces</h3>
      <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Starting, lost, and surviving forces are captured separately so no colour-only comparison is required.</p>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div className="stack"><CombatQuantitySection title="Combat ships at start" quantities={report.defender.ships.starting} /><CombatQuantitySection title="Combat ships lost" quantities={report.defender.ships.lost} /><CombatQuantitySection title="Combat ships surviving" quantities={report.defender.ships.surviving} /></div>
        <div className="stack"><CombatQuantitySection title="Defences at start" quantities={report.defender.defences.starting} /><CombatQuantitySection title="Defences lost" quantities={report.defender.defences.lost} /><CombatQuantitySection title="Defences surviving" quantities={report.defender.defences.surviving} /></div>
      </div>
    </section>
    <section className="panel stack">
      <h3 style={{ margin: 0 }}>Rounds</h3>
      {report.rounds.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No combat rounds were recorded. A draw result does not disclose hidden combat mechanics.</p> : <ol className="stack" style={{ margin: 0, paddingInlineStart: '1.5rem' }}>
        {report.rounds.map((round) => <li key={round.round}>Round {round.round}: attacker lost {formatNumber(round.attackerLostFrigates)} Frigate{round.attackerLostFrigates === 1 ? '' : 's'}; defender lost {formatNumber(round.defenderLostUnits)} unit{round.defenderLostUnits === 1 ? '' : 's'}.</li>)}
      </ol>}
    </section>
  </div>;
}

export default function ReportsPage() {
  const [page, setPage] = useState(1);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [combatPage, setCombatPage] = useState(1);
  const [selectedCombatReportId, setSelectedCombatReportId] = useState<string | null>(null);
  const [frigatePage, setFrigatePage] = useState(1);
  const [selectedFrigateReportId, setSelectedFrigateReportId] = useState<string | null>(null);
  const loadReports = useCallback(async () => {
    try {
      return await apiGet<EspionageProbeReportsResponse>(`/api/espionage/reports?page=${page}`);
    } catch (error) {
      throw reportAccessError(error);
    }
  }, [page]);
  const loadSelectedReport = useCallback(async (): Promise<EspionageProbeReportDetail | null> => {
    if (!selectedReportId) return null;
    try {
      return await apiGet<EspionageProbeReportDetail>(`/api/espionage/reports/${encodeURIComponent(selectedReportId)}`);
    } catch (error) {
      throw reportAccessError(error, true);
    }
  }, [selectedReportId]);
  const { data, loading, error } = useApiData(loadReports);
  const {
    data: selectedReport,
    loading: selectedLoading,
    error: selectedError,
  } = useApiData(loadSelectedReport);
  const loadCombatReports = useCallback(async () => {
    try {
      return await apiGet<CorvetteStrikeReportsResponse>(`/api/combat/strikes/reports?page=${combatPage}`);
    } catch (error) {
      throw combatReportAccessError(error);
    }
  }, [combatPage]);
  const loadSelectedCombatReport = useCallback(async (): Promise<CorvetteStrikeReportDetail | null> => {
    if (!selectedCombatReportId) return null;
    try {
      return await apiGet<CorvetteStrikeReportDetail>(`/api/combat/strikes/reports/${encodeURIComponent(selectedCombatReportId)}`);
    } catch (error) {
      throw combatReportAccessError(error, true);
    }
  }, [selectedCombatReportId]);
  const {
    data: combatData,
    loading: combatLoading,
    error: combatError,
  } = useApiData(loadCombatReports);
  const {
    data: selectedCombatReport,
    loading: selectedCombatLoading,
    error: selectedCombatError,
  } = useApiData(loadSelectedCombatReport);
  const loadFrigateReports = useCallback(async () => {
    try {
      return await apiGet<FrigateStrikeReportsResponse>(`/api/combat/frigate-strikes/reports?page=${frigatePage}`);
    } catch (error) {
      throw frigateReportAccessError(error);
    }
  }, [frigatePage]);
  const loadSelectedFrigateReport = useCallback(async (): Promise<FrigateStrikeReportDetail | null> => {
    if (!selectedFrigateReportId) return null;
    try {
      return await apiGet<FrigateStrikeReportDetail>(`/api/combat/frigate-strikes/reports/${encodeURIComponent(selectedFrigateReportId)}`);
    } catch (error) {
      throw frigateReportAccessError(error, true);
    }
  }, [selectedFrigateReportId]);
  const {
    data: frigateData,
    loading: frigateLoading,
    error: frigateError,
  } = useApiData(loadFrigateReports);
  const {
    data: selectedFrigateReport,
    loading: selectedFrigateLoading,
    error: selectedFrigateError,
  } = useApiData(loadSelectedFrigateReport);
  const isPermissionError = error === 'You do not have permission to view Probe Intelligence reports.';
  const canPrevious = (data?.page ?? 1) > 1;
  const canNext = data ? data.page * data.pageSize < data.total : false;
  const canCombatPrevious = (combatData?.page ?? 1) > 1;
  const canCombatNext = combatData ? combatData.page * combatData.pageSize < combatData.total : false;
  const canFrigatePrevious = (frigateData?.page ?? 1) > 1;
  const canFrigateNext = frigateData ? frigateData.page * frigateData.pageSize < frigateData.total : false;

  function changePage(nextPage: number) {
    setSelectedReportId(null);
    setPage(nextPage);
  }

  function changeCombatPage(nextPage: number) {
    setSelectedCombatReportId(null);
    setCombatPage(nextPage);
  }

  function changeFrigatePage(nextPage: number) {
    setSelectedFrigateReportId(null);
    setFrigatePage(nextPage);
  }

  return (
    <section className="stack">
      <div className="panel stack">
        <h1 style={{ margin: 0 }}>Probe Intelligence</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Review immutable intelligence snapshots captured by your Espionage Probes. These reports never update with live target state.</p>
      </div>
      {loading ? <StatusPanel message="Loading Probe Intelligence reports..." /> : null}
      {error ? <StatusPanel tone="error" title={isPermissionError ? 'Report access denied' : 'Unable to load reports'} message={error} /> : null}
      {!loading && !error && data && selectedReportId ? (
        selectedLoading ? <div className="stack"><StatusPanel message="Loading selected intelligence report..." /><div><button type="button" onClick={() => setSelectedReportId(null)}>Back to report list</button></div></div>
          : selectedError ? <div className="stack"><StatusPanel tone="error" title="Report unavailable" message={selectedError} /><div><button type="button" onClick={() => setSelectedReportId(null)}>Back to report list</button></div></div>
            : selectedReport ? <ReportDetail report={selectedReport} onReturn={() => setSelectedReportId(null)} />
              : <StatusPanel message="No report was selected." />
      ) : null}
      {!loading && !error && data && !selectedReportId ? (
        <div className="stack">
          {data.reports.length === 0 ? <StatusPanel title="No Probe Intelligence reports" message="Launch an Espionage Probe from Galaxy to capture your first immutable intelligence snapshot." /> : data.reports.map((report) => (
            <ReportListItem key={report.id} report={report} selected={false} onSelect={setSelectedReportId} />
          ))}
          <div className="panel" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: 'var(--color-text-muted)' }}>Page {data.page} · {formatNumber(data.total)} reports</span>
            <div className="button-row">
              <button type="button" onClick={() => changePage(data.page - 1)} disabled={!canPrevious}>Previous</button>
              <button type="button" onClick={() => changePage(data.page + 1)} disabled={!canNext}>Next</button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="panel stack">
        <h2 style={{ margin: 0 }}>Combat Results</h2>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Review immutable no-loot Corvette strike snapshots. These results never update with live target data.</p>
      </div>
      {combatLoading ? <StatusPanel message="Loading Combat Results..." /> : null}
      {combatError ? <StatusPanel tone="error" title={combatError === 'You do not have permission to view Combat Results.' ? 'Report access denied' : 'Unable to load combat results'} message={combatError} /> : null}
      {!combatLoading && !combatError && combatData && selectedCombatReportId ? (
        selectedCombatLoading ? <div className="stack"><StatusPanel message="Loading selected combat result..." /><div><button type="button" onClick={() => setSelectedCombatReportId(null)}>Back to combat results</button></div></div>
          : selectedCombatError ? <div className="stack"><StatusPanel tone="error" title="Combat result unavailable" message={selectedCombatError} /><div><button type="button" onClick={() => setSelectedCombatReportId(null)}>Back to combat results</button></div></div>
            : selectedCombatReport ? <CombatReportDetail report={selectedCombatReport} onReturn={() => setSelectedCombatReportId(null)} />
              : <StatusPanel message="No combat result was selected." />
      ) : null}
      {!combatLoading && !combatError && combatData && !selectedCombatReportId ? <div className="stack">
        {combatData.reports.length === 0 ? <StatusPanel title="No Combat Results" message="Launch a Corvette strike from Galaxy to capture your first immutable combat snapshot." /> : combatData.reports.map((report) => (
          <CombatReportListItem key={report.id} report={report} selected={false} onSelect={setSelectedCombatReportId} />
        ))}
        <div className="panel" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: 'var(--color-text-muted)' }}>Page {combatData.page} · {formatNumber(combatData.total)} results</span>
          <div className="button-row">
            <button type="button" onClick={() => changeCombatPage(combatData.page - 1)} disabled={!canCombatPrevious}>Previous</button>
            <button type="button" onClick={() => changeCombatPage(combatData.page + 1)} disabled={!canCombatNext}>Next</button>
          </div>
        </div>
      </div> : null}
      <div className="panel stack">
        <h2 style={{ margin: 0 }}>Frigate Strike Results</h2>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Review immutable no-loot Frigate strike snapshots. These results never update with live target data or reveal combat internals.</p>
      </div>
      {frigateLoading ? <StatusPanel message="Loading Frigate Strike Results..." /> : null}
      {frigateError ? <StatusPanel tone="error" title={frigateError === 'You do not have permission to view Frigate Strike Results.' ? 'Report access denied' : 'Unable to load Frigate strike results'} message={frigateError} /> : null}
      {!frigateLoading && !frigateError && frigateData && selectedFrigateReportId ? (
        selectedFrigateLoading ? <div className="stack"><StatusPanel message="Loading selected Frigate strike result..." /><div><button type="button" onClick={() => setSelectedFrigateReportId(null)}>Back to Frigate results</button></div></div>
          : selectedFrigateError ? <div className="stack"><StatusPanel tone="error" title="Frigate strike result unavailable" message={selectedFrigateError} /><div><button type="button" onClick={() => setSelectedFrigateReportId(null)}>Back to Frigate results</button></div></div>
            : selectedFrigateReport ? <FrigateCombatReportDetail report={selectedFrigateReport} onReturn={() => setSelectedFrigateReportId(null)} />
              : <StatusPanel message="No Frigate strike result was selected." />
      ) : null}
      {!frigateLoading && !frigateError && frigateData && !selectedFrigateReportId ? <div className="stack">
        {frigateData.reports.length === 0 ? <StatusPanel title="No Frigate Strike Results" message="Launch a Frigate strike from Fleet to capture your first immutable combat snapshot." /> : frigateData.reports.map((report) => (
          <FrigateCombatReportListItem key={report.id} report={report} selected={false} onSelect={setSelectedFrigateReportId} />
        ))}
        <div className="panel" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: 'var(--color-text-muted)' }}>Page {frigateData.page} · {formatNumber(frigateData.total)} results</span>
          <div className="button-row">
            <button type="button" onClick={() => changeFrigatePage(frigateData.page - 1)} disabled={!canFrigatePrevious}>Previous</button>
            <button type="button" onClick={() => changeFrigatePage(frigateData.page + 1)} disabled={!canFrigateNext}>Next</button>
          </div>
        </div>
      </div> : null}
    </section>
  );
}

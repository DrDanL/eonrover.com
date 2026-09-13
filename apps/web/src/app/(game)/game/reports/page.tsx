'use client';

import { useCallback, useState } from 'react';
import StatusPanel from '@/components/StatusPanel';
import { ApiError, apiGet } from '@/lib/api';
import { enumLabel, formatCoords, formatDateTime, formatNumber } from '@/lib/formatters';
import { getErrorMessage, useApiData } from '@/lib/useApiData';
import {
  EspionageProbeReportDetail,
  EspionageProbeReportListItem,
  EspionageProbeReportsResponse,
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

export default function ReportsPage() {
  const [page, setPage] = useState(1);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
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
  const isPermissionError = error === 'You do not have permission to view Probe Intelligence reports.';
  const canPrevious = (data?.page ?? 1) > 1;
  const canNext = data ? data.page * data.pageSize < data.total : false;

  function changePage(nextPage: number) {
    setSelectedReportId(null);
    setPage(nextPage);
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
    </section>
  );
}

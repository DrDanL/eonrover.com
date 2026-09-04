'use client';

import { useCallback } from 'react';
import StatusPanel from '@/components/StatusPanel';
import { apiGet } from '@/lib/api';
import { formatDateTime } from '@/lib/formatters';
import { useApiData } from '@/lib/useApiData';
import { CombatReport, EspionageReport } from '@/lib/web-types';

export default function ReportsPage() {
  const loadReports = useCallback(
    async () => Promise.all([
      apiGet<{ reports: CombatReport[] }>('/api/reports/combat'),
      apiGet<{ reports: EspionageReport[] }>('/api/reports/espionage'),
    ]),
    [],
  );
  const { data, loading, error } = useApiData(loadReports);
  const combatReports = data?.[0]?.reports ?? [];
  const espionageReports = data?.[1]?.reports ?? [];

  return (
    <section className="stack">
      <div className="panel stack"><h1 style={{ margin: 0 }}>Reports</h1><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Review combat outcomes and espionage intelligence packages.</p></div>
      {loading ? <StatusPanel message="Loading reports..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load reports" message={error} /> : null}
      {!loading && !error && !data ? <StatusPanel message="No reports available." /> : null}
      {!loading && !error && data ? (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          <div className="panel stack">
            <h2 style={{ margin: 0 }}>Combat</h2>
            {combatReports.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No combat reports yet.</p> : null}
            {combatReports.map((report) => (
              <article className="panel stack" key={report.id}>
                <strong>{report.outcome}</strong>
                <span style={{ color: 'var(--color-text-muted)' }}>{formatDateTime(report.createdAt)}</span>
                <pre className="json-block">{JSON.stringify(report.debris, null, 2)}</pre>
              </article>
            ))}
          </div>
          <div className="panel stack">
            <h2 style={{ margin: 0 }}>Espionage</h2>
            {espionageReports.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No espionage reports yet.</p> : null}
            {espionageReports.map((report) => (
              <article className="panel stack" key={report.id}>
                <strong>Accuracy {Math.round(report.accuracy * 100)}%</strong>
                <span style={{ color: 'var(--color-text-muted)' }}>{formatDateTime(report.createdAt)}</span>
                <pre className="json-block">{JSON.stringify(report.data, null, 2)}</pre>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

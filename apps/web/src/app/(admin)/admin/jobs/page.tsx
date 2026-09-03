'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import StatusPanel from '@/components/StatusPanel';
import { apiDelete, apiGet } from '@/lib/api';
import { getErrorMessage, useApiData } from '@/lib/useApiData';
import { QueueJob } from '@/lib/web-types';

interface QueueGroup {
  queue: string;
  failed: QueueJob[];
  delayed: QueueJob[];
}

export default function AdminJobsPage() {
  const { user } = useAuth();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const loadJobs = useCallback(() => apiGet<{ jobs: QueueGroup[] }>('/api/admin/jobs'), []);
  const { data, loading, error, reload } = useApiData(loadJobs);

  async function removeJob(queue: string, id: string) {
    setBusyId(`${queue}-${id}`);
    setActionError(null);
    try {
      await apiDelete(`/api/admin/jobs/${queue}/${id}`);
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const canEdit = user?.role === 'ADMIN';

  return (
    <section className="stack">
      <div className="panel stack"><h1 style={{ margin: 0 }}>Jobs</h1><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Inspect delayed and failed queue jobs across build, research, shipyard, and fleet workers.</p></div>
      {loading ? <StatusPanel message="Loading jobs..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load jobs" message={error} /> : null}
      {actionError ? <StatusPanel tone="error" title="Job action failed" message={actionError} /> : null}
      {!loading && !error && data?.jobs.length === 0 ? <StatusPanel message="No queue information is available." /> : null}
      {!loading && !error && data?.jobs.map((group) => (
        <article className="panel stack" key={group.queue}>
          <h2 style={{ margin: 0 }}>{group.queue}</h2>
          {group.failed.length === 0 && group.delayed.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No delayed or failed jobs.</p> : null}
          {group.failed.map((job) => (
            <div className="panel stack" key={`failed-${job.id}`}>
              <strong>Failed · {job.name}</strong>
              <pre className="json-block">{JSON.stringify(job.data, null, 2)}</pre>
              <p style={{ margin: 0, color: 'var(--color-danger)' }}>{job.failedReason ?? 'Unknown failure'}</p>
              <button type="button" onClick={() => removeJob(group.queue, String(job.id))} disabled={!canEdit || busyId === `${group.queue}-${job.id}`}>{busyId === `${group.queue}-${job.id}` ? 'Removing...' : 'Remove job'}</button>
            </div>
          ))}
          {group.delayed.map((job) => (
            <div className="panel stack" key={`delayed-${job.id}`}>
              <strong>Delayed · {job.name}</strong>
              <pre className="json-block">{JSON.stringify(job.data, null, 2)}</pre>
              <button type="button" onClick={() => removeJob(group.queue, String(job.id))} disabled={!canEdit || busyId === `${group.queue}-${job.id}`}>{busyId === `${group.queue}-${job.id}` ? 'Removing...' : 'Remove job'}</button>
            </div>
          ))}
        </article>
      ))}
      {!canEdit ? <StatusPanel message="Moderators can inspect job state, but only admins can remove jobs." /> : null}
    </section>
  );
}

'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import StatusPanel from '@/components/StatusPanel';
import { apiGet, apiPost } from '@/lib/api';
import { getErrorMessage, useApiData } from '@/lib/useApiData';
import { UniverseConfig } from '@/lib/web-types';

const CONFIG_KEYS: Array<keyof UniverseConfig> = [
  'universeSpeed',
  'economySpeed',
  'fleetSpeed',
  'researchSpeed',
  'newPlayerProtectionHours',
  'maxPlanetsPerPlayer',
];

export default function AdminConfigPage() {
  const { user } = useAuth();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const loadConfig = useCallback(
    () => apiGet<{ config: UniverseConfig; defaults: UniverseConfig }>('/api/admin/config'),
    [],
  );
  const { data, loading, error, reload } = useApiData(loadConfig);

  async function saveKey(key: keyof UniverseConfig) {
    const value = Number(drafts[key] ?? data?.config[key]);
    if (!Number.isFinite(value) || value <= 0) {
      setActionError('Configuration values must be positive numbers.');
      return;
    }
    setBusyKey(key);
    setActionError(null);
    try {
      await apiPost('/api/admin/config', { key, value });
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  const canEdit = user?.role === 'ADMIN';

  return (
    <section className="stack">
      <div className="panel stack"><h1 style={{ margin: 0 }}>Universe Config</h1><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Adjust live economy, research, and expansion settings.</p></div>
      {loading ? <StatusPanel message="Loading config..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load config" message={error} /> : null}
      {actionError ? <StatusPanel tone="error" title="Config update failed" message={actionError} /> : null}
      {!loading && !error && !data ? <StatusPanel message="No configuration returned." /> : null}
      {!loading && !error && data ? (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {CONFIG_KEYS.map((key) => (
            <div className="panel stack" key={key}>
              <strong>{key}</strong>
              <span style={{ color: 'var(--color-text-muted)' }}>Default: {String(data.defaults[key])}</span>
              <input value={drafts[key] ?? String(data.config[key])} onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))} disabled={!canEdit} />
              <button type="button" onClick={() => saveKey(key)} disabled={!canEdit || busyKey === key}>{busyKey === key ? 'Saving...' : 'Save'}</button>
            </div>
          ))}
          {!canEdit ? <StatusPanel message="Moderators can review settings, but only admins can update them." /> : null}
        </div>
      ) : null}
    </section>
  );
}

'use client';

import { useCallback } from 'react';
import StatusPanel from '@/components/StatusPanel';
import { apiGet } from '@/lib/api';
import { formatNumber } from '@/lib/formatters';
import { useApiData } from '@/lib/useApiData';
import { LeaderboardEntry } from '@/lib/web-types';

export default function GameLeaderboardPage() {
  const loadBoard = useCallback(() => apiGet<{ leaderboard: LeaderboardEntry[] }>('/api/leaderboard'), []);
  const { data, loading, error } = useApiData(loadBoard);

  return (
    <section className="stack">
      <div className="panel stack"><h1 style={{ margin: 0 }}>Leaderboard</h1><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Track the top empires in the live universe.</p></div>
      {loading ? <StatusPanel message="Loading leaderboard..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load leaderboard" message={error} /> : null}
      {!loading && !error && data?.leaderboard.length === 0 ? <StatusPanel message="No ranked players yet." /> : null}
      {!loading && !error && data?.leaderboard.length ? (
        <div className="panel">
          <table>
            <thead><tr><th>#</th><th>Commander</th><th>Alliance</th><th>Planets</th><th>Score</th></tr></thead>
            <tbody>
              {data.leaderboard.map((entry, index) => (
                <tr key={`${entry.username}-${index}`}><td>{index + 1}</td><td>{entry.username}</td><td>{entry.alliance ?? '—'}</td><td>{formatNumber(entry.planetCount)}</td><td>{formatNumber(entry.score)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

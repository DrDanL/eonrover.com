'use client';

import { useCallback } from 'react';
import StatusPanel from '@/components/StatusPanel';
import { apiGet } from '@/lib/api';
import { formatNumber } from '@/lib/formatters';
import { useApiData } from '@/lib/useApiData';
import { LeaderboardEntry } from '@/lib/web-types';

export default function PublicLeaderboardPage() {
  const loadBoard = useCallback(() => apiGet<{ leaderboard: LeaderboardEntry[] }>('/api/public/leaderboard-preview'), []);
  const { data, loading, error } = useApiData(loadBoard);

  return (
    <section className="stack" style={{ padding: '2rem 0 4rem' }}>
      <div className="panel stack">
        <h1 style={{ margin: 0 }}>Public Leaderboard</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Top commanders by planetary development score.</p>
      </div>
      {loading ? <StatusPanel message="Loading leaderboard..." /> : null}
      {error ? <StatusPanel tone="error" title="Leaderboard unavailable" message={error} /> : null}
      {!loading && !error && data?.leaderboard.length === 0 ? <StatusPanel message="No ranked commanders yet." /> : null}
      {!loading && !error && data && data.leaderboard.length > 0 ? (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Commander</th>
                <th>Alliance</th>
                <th>Planets</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {data.leaderboard.map((entry, index) => (
                <tr key={`${entry.username}-${index}`}>
                  <td>{index + 1}</td>
                  <td>{entry.username}</td>
                  <td>{entry.alliance ?? '—'}</td>
                  <td>{formatNumber(entry.planetCount)}</td>
                  <td>{formatNumber(entry.score)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

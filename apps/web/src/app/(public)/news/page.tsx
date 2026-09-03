'use client';

import { useCallback } from 'react';
import StatusPanel from '@/components/StatusPanel';
import { apiGet } from '@/lib/api';
import { formatDateTime } from '@/lib/formatters';
import { useApiData } from '@/lib/useApiData';
import { Announcement } from '@/lib/web-types';

export default function NewsPage() {
  const loadNews = useCallback(() => apiGet<{ announcements: Announcement[] }>('/api/public/announcements'), []);
  const { data, loading, error } = useApiData(loadNews);

  return (
    <section className="stack" style={{ padding: '2rem 0 4rem' }}>
      <div className="panel stack">
        <h1 style={{ margin: 0 }}>News from the Reach</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Latest announcements from the command network.</p>
      </div>
      {loading ? <StatusPanel message="Loading announcements..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load news" message={error} /> : null}
      {!loading && !error && data?.announcements.length === 0 ? <StatusPanel message="No announcements have been posted yet." /> : null}
      {!loading && !error && data?.announcements.map((announcement) => (
        <article className="panel stack" key={announcement.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>{announcement.title}</h2>
            <span className="tag">{formatDateTime(announcement.createdAt)}</span>
          </div>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--color-text-muted)' }}>{announcement.body}</p>
        </article>
      ))}
    </section>
  );
}

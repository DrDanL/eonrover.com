'use client';

import { FormEvent, useCallback, useState } from 'react';
import StatusPanel from '@/components/StatusPanel';
import { apiGet, apiPost } from '@/lib/api';
import { formatDateTime } from '@/lib/formatters';
import { getErrorMessage, useApiData } from '@/lib/useApiData';
import { GameMessage } from '@/lib/web-types';

export default function MessagesPage() {
  const [recipientUsername, setRecipientUsername] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const loadMessages = useCallback(() => apiGet<{ inbox: GameMessage[]; sent: GameMessage[] }>('/api/messages'), []);
  const { data, loading, error, reload } = useApiData(loadMessages);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setActionError(null);
    try {
      await apiPost('/api/messages', { recipientUsername, subject, body });
      setRecipientUsername('');
      setSubject('');
      setBody('');
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function markAsRead(messageId: string) {
    setMarkingId(messageId);
    setActionError(null);
    try {
      await apiPost(`/api/messages/${messageId}/read`);
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setMarkingId(null);
    }
  }

  return (
    <section className="stack">
      <div className="panel stack"><h1 style={{ margin: 0 }}>Messages</h1><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Coordinate with other commanders and keep your inbox tidy.</p></div>
      {loading ? <StatusPanel message="Loading messages..." /> : null}
      {error ? <StatusPanel tone="error" title="Unable to load messages" message={error} /> : null}
      {actionError ? <StatusPanel tone="error" title="Message action failed" message={actionError} /> : null}
      {!loading && !error && data ? (
        <>
          <form className="panel stack" onSubmit={handleSubmit}>
            <h2 style={{ margin: 0 }}>Compose</h2>
            <label>Recipient username<input value={recipientUsername} onChange={(event) => setRecipientUsername(event.target.value)} required /></label>
            <label>Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={120} required /></label>
            <label>Body<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={6} maxLength={4000} required /></label>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Sending...' : 'Send message'}</button>
          </form>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <div className="panel stack">
              <h2 style={{ margin: 0 }}>Inbox</h2>
              {data.inbox.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No messages received.</p> : null}
              {data.inbox.map((message) => (
                <article className="panel stack" key={message.id}>
                  <strong>{message.subject}</strong>
                  <span style={{ color: 'var(--color-text-muted)' }}>From {message.sender?.username ?? 'Unknown'} · {formatDateTime(message.createdAt)}</span>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{message.body}</p>
                  {!message.readAt ? <button type="button" onClick={() => markAsRead(message.id)} disabled={markingId === message.id}>{markingId === message.id ? 'Marking...' : 'Mark as read'}</button> : <span className="tag">Read</span>}
                </article>
              ))}
            </div>
            <div className="panel stack">
              <h2 style={{ margin: 0 }}>Sent</h2>
              {data.sent.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No outbound messages yet.</p> : null}
              {data.sent.map((message) => (
                <article className="panel stack" key={message.id}>
                  <strong>{message.subject}</strong>
                  <span style={{ color: 'var(--color-text-muted)' }}>To {message.recipient?.username ?? 'Unknown'} · {formatDateTime(message.createdAt)}</span>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{message.body}</p>
                </article>
              ))}
            </div>
          </div>
        </>
      ) : null}
      {!loading && !error && !data ? <StatusPanel message="No message data returned." /> : null}
    </section>
  );
}

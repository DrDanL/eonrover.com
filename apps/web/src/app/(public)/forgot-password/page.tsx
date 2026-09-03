'use client';

import { FormEvent, useState } from 'react';
import StatusPanel from '@/components/StatusPanel';
import { apiPost } from '@/lib/api';
import { getErrorMessage } from '@/lib/useApiData';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await apiPost<{ message: string }>('/api/auth/forgot-password', { email });
      setMessage(response.message);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="stack narrow-stack" style={{ padding: '2rem 0 4rem' }}>
      <div className="panel stack">
        <h1 style={{ margin: 0 }}>Forgot password</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Request a reset link and finish the update from your email.</p>
      </div>
      {error ? <StatusPanel tone="error" title="Request failed" message={error} /> : null}
      {message ? <StatusPanel tone="success" title="Request accepted" message={message} /> : null}
      <form className="panel stack" onSubmit={handleSubmit}>
        <label>
          Account email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Sending...' : 'Send reset link'}</button>
      </form>
    </section>
  );
}

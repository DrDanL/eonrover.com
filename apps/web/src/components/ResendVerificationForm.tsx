'use client';

import { FormEvent, useState } from 'react';
import { apiPost } from '@/lib/api';
import { getErrorMessage } from '@/lib/useApiData';
import StatusPanel from './StatusPanel';

interface ResendVerificationFormProps {
  initialEmail?: string;
}

export default function ResendVerificationForm({ initialEmail = '' }: ResendVerificationFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await apiPost<{ message: string }>('/api/auth/resend-verification', { email });
      setMessage(response.message);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack">
      {error ? <StatusPanel tone="error" title="Request failed" message={error} /> : null}
      {message ? <StatusPanel tone="success" title="Request accepted" message={message} /> : null}
      <form className="panel stack" onSubmit={handleSubmit} aria-busy={loading}>
        <label>
          Account email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            disabled={loading}
            required
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Sending...' : 'Send verification email'}
        </button>
      </form>
    </div>
  );
}

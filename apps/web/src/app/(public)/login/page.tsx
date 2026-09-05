'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import StatusPanel from '@/components/StatusPanel';
import { ApiError, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { getErrorMessage } from '@/lib/useApiData';

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      await apiPost('/api/auth/login', { email, password });
      await refresh();
      router.replace('/game');
    } catch (err) {
      setError(getErrorMessage(err));
      setErrorCode(err instanceof ApiError ? err.code ?? null : null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="stack narrow-stack" style={{ padding: '2rem 0 4rem' }}>
      <div className="panel stack">
        <h1 style={{ margin: 0 }}>Sign in</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Reconnect to your colonies and queued operations.</p>
      </div>
      {error ? (
        <div className="stack">
          <StatusPanel tone="error" title="Sign-in failed" message={error} />
          {errorCode === 'EMAIL_NOT_VERIFIED' ? (
            <Link href="/resend-verification">Request another verification email</Link>
          ) : null}
        </div>
      ) : null}
      <form className="panel stack" onSubmit={handleSubmit} aria-busy={loading}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            disabled={loading}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            disabled={loading}
            required
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</button>
      </form>
      <div className="panel stack">
        <Link href="/forgot-password">Forgot password?</Link>
        <Link href="/resend-verification">Request another verification email</Link>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
          Need a new account? <Link href="/register">Register here</Link>.
        </p>
      </div>
    </section>
  );
}

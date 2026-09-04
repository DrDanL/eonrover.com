'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import StatusPanel from '@/components/StatusPanel';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { getErrorMessage } from '@/lib/useApiData';

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiPost('/api/auth/login', { email, password });
      await refresh();
      router.replace('/game');
    } catch (err) {
      setError(getErrorMessage(err));
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
      {error ? <StatusPanel tone="error" title="Sign-in failed" message={error} /> : null}
      <form className="panel stack" onSubmit={handleSubmit}>
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</button>
      </form>
      <div className="panel stack">
        <Link href="/forgot-password">Forgot password?</Link>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
          Need a new account? <Link href="/register">Register here</Link>.
        </p>
      </div>
    </section>
  );
}

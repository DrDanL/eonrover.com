'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import StatusPanel from '@/components/StatusPanel';
import { apiPost } from '@/lib/api';
import { getErrorMessage } from '@/lib/useApiData';

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError('Reset token missing. Open the reset link from your email.');
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await apiPost<{ message: string }>('/api/auth/reset-password', { token, password });
      setMessage(response.message);
      setPassword('');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="stack narrow-stack" style={{ padding: '2rem 0 4rem' }}>
      <div className="panel stack">
        <h1 style={{ margin: 0 }}>Reset password</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Choose a new password for your command account.</p>
      </div>
      {!token ? <StatusPanel tone="error" title="Token missing" message="Use the password reset link delivered by email." /> : null}
      {error ? <StatusPanel tone="error" title="Reset failed" message={error} /> : null}
      {message ? <StatusPanel tone="success" title="Password updated" message={message} /> : null}
      <form className="panel stack" onSubmit={handleSubmit}>
        <label>
          New password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required />
        </label>
        <button type="submit" className="btn btn-primary" disabled={loading || !token}>{loading ? 'Updating...' : 'Update password'}</button>
      </form>
      <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
        Ready to return? <Link href="/login">Sign in</Link>.
      </p>
    </section>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<section className="stack narrow-stack" style={{ padding: '2rem 0 4rem' }}><StatusPanel message="Preparing reset form..." /></section>}>
      <ResetPasswordContent />
    </Suspense>
  );
}

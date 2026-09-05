'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import ResendVerificationForm from '@/components/ResendVerificationForm';
import StatusPanel from '@/components/StatusPanel';
import { apiPost } from '@/lib/api';
import { getErrorMessage } from '@/lib/useApiData';

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    message: string;
    requiresVerification: boolean;
    verificationEmailSent: boolean;
    email: string;
  } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const submittedEmail = email.trim();
      const response = await apiPost<{
        message: string;
        requiresVerification: boolean;
        verificationEmailSent: boolean;
      }>('/api/auth/register', { username, email, password });
      setResult({ ...response, email: submittedEmail });
      setUsername('');
      setEmail('');
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
        <h1 style={{ margin: 0 }}>Register</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Claim your first world and confirm your email to enter the Reach.</p>
      </div>
      {error ? <StatusPanel tone="error" title="Registration failed" message={error} /> : null}
      {result ? (
        <StatusPanel
          tone={result.verificationEmailSent ? 'success' : 'default'}
          title="Account created"
          message={result.message}
        />
      ) : null}
      {result && !result.verificationEmailSent ? (
        <ResendVerificationForm initialEmail={result.email} />
      ) : null}
      <form className="panel stack" onSubmit={handleSubmit}>
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={20} required />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required />
        </label>
        <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Registering...' : 'Create account'}</button>
      </form>
      <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
        Already enlisted? <Link href="/login">Sign in</Link>.
      </p>
      <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
        Need another link? <Link href="/resend-verification">Resend your verification email</Link>.
      </p>
    </section>
  );
}

'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ResendVerificationForm from '@/components/ResendVerificationForm';
import StatusPanel from '@/components/StatusPanel';
import { apiPost } from '@/lib/api';
import { getErrorMessage } from '@/lib/useApiData';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError('Verification token missing. Use the link from your email.');
      return;
    }

    let cancelled = false;

    async function verify() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiPost<{ message: string }>('/api/auth/verify-email', { token });
        if (!cancelled) setMessage(response.message);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void verify();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <section className="stack narrow-stack" style={{ padding: '2rem 0 4rem' }}>
      <div className="panel stack">
        <h1 style={{ margin: 0 }}>Verify email</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Confirming your command credentials.</p>
      </div>
      {loading ? <StatusPanel message="Verifying token..." /> : null}
      {!loading && error ? <StatusPanel tone="error" title="Verification failed" message={error} /> : null}
      {!loading && message ? <StatusPanel tone="success" title="Verification complete" message={message} /> : null}
      {!loading && !message ? (
        <div className="stack">
          <h2 style={{ marginBottom: 0 }}>Request a new link</h2>
          <ResendVerificationForm />
        </div>
      ) : null}
      <div className="panel stack">
        <Link href="/login">Proceed to sign in</Link>
      </div>
    </section>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<section className="stack narrow-stack" style={{ padding: '2rem 0 4rem' }}><StatusPanel message="Preparing verification..." /></section>}>
      <VerifyEmailContent />
    </Suspense>
  );
}

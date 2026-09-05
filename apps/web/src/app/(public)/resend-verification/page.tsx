import Link from 'next/link';
import ResendVerificationForm from '@/components/ResendVerificationForm';

export default function ResendVerificationPage() {
  return (
    <section className="stack narrow-stack" style={{ padding: '2rem 0 4rem' }}>
      <div className="panel stack">
        <h1 style={{ margin: 0 }}>Resend verification email</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
          Request a fresh verification link for an account that has not been verified yet.
        </p>
      </div>
      <ResendVerificationForm />
      <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
        Already verified? <Link href="/login">Sign in</Link>.
      </p>
    </section>
  );
}

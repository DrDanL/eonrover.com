'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import StatusPanel from '@/components/StatusPanel';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { getErrorMessage } from '@/lib/useApiData';

export default function SettingsPage() {
  const router = useRouter();
  const { user, setUser } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    setError(null);
    try {
      await apiPost('/api/auth/logout');
      setUser(null);
      router.replace('/login');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <section className="stack">
      <div className="panel stack"><h1 style={{ margin: 0 }}>Settings</h1><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Manage session access and review the account data currently exposed by the API.</p></div>
      {!user ? <StatusPanel message="Loading account settings..." /> : null}
      {error ? <StatusPanel tone="error" title="Settings action failed" message={error} /> : null}
      {user ? (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          <div className="panel stack">
            <h2 style={{ margin: 0 }}>Account</h2>
            <p style={{ margin: 0 }}>Username: {user.username}</p>
            <p style={{ margin: 0 }}>Email: {user.email}</p>
            <p style={{ margin: 0 }}>Role: {user.role}</p>
            <p style={{ margin: 0 }}>Status: {user.status ?? 'ACTIVE'}</p>
          </div>
          <div className="panel stack">
            <h2 style={{ margin: 0 }}>Security</h2>
            <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Password changes use the reset-email flow exposed by the auth API.</p>
            <div className="cta-row" style={{ justifyContent: 'flex-start' }}>
              <Link href="/forgot-password" className="btn">Reset password</Link>
              <button type="button" onClick={logout} disabled={loggingOut}>{loggingOut ? 'Signing out...' : 'Sign out'}</button>
            </div>
          </div>
          <div className="panel stack">
            <h2 style={{ margin: 0 }}>API coverage</h2>
            <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Session lists and in-place password changes are not yet exposed by the current API, so they are shown here as unavailable.</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

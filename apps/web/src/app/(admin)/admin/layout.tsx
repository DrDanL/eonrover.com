'use client';

import Link from 'next/link';
import SidebarNav from '@/components/SidebarNav';
import StatusPanel from '@/components/StatusPanel';
import { useAuth } from '@/lib/AuthContext';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, error } = useAuth();

  if (loading) {
    return (
      <main className="container public-main">
        <StatusPanel message="Loading admin console..." />
      </main>
    );
  }

  if (!user || (user.role !== 'ADMIN' && user.role !== 'MODERATOR')) {
    return (
      <main className="container public-main stack">
        <StatusPanel tone="error" title="Permission denied" message="You need moderator or admin access to use the administration console." />
        <Link href="/game" className="btn">Return to game</Link>
      </main>
    );
  }

  return (
    <div className="game-shell">
      <aside className="game-sidebar">
        <SidebarNav
          title="Admin Console"
          subtitle={`${user.role} access`}
          sections={[
            {
              items: [
                { href: '/admin', label: 'Dashboard' },
                ...(user.role === 'ADMIN' ? [{ href: '/admin/users', label: 'Player state' }] : []),
                { href: '/admin/announcements', label: 'Announcements' },
                { href: '/admin/config', label: 'Config' },
                { href: '/admin/jobs', label: 'Jobs' },
                { href: '/admin/security', label: 'Security' },
                { href: '/admin/audit', label: 'Audit' },
                { href: '/game', label: 'Back to game' },
              ],
            },
          ]}
        />
      </aside>
      <main className="game-main stack">
        {error ? <StatusPanel tone="error" title="Auth warning" message={error} /> : null}
        {children}
      </main>
    </div>
  );
}

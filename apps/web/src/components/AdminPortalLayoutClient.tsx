'use client';

import Link from 'next/link';
import SidebarNav from '@/components/SidebarNav';
import StatusPanel from '@/components/StatusPanel';
import { useAuth } from '@/lib/AuthContext';

export default function AdminPortalLayoutClient({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <main className="container public-main"><StatusPanel message="Checking administrator access..." /></main>;
  }

  if (!user || user.role !== 'ADMIN') {
    return (
      <main className="container public-main stack">
        <StatusPanel tone="error" title="Permission denied" message="Administrator access is required." />
        <Link href="/game" className="btn">Return to game</Link>
      </main>
    );
  }

  return (
    <div className="game-shell">
      <aside className="game-sidebar">
        <SidebarNav
          title="Administrator"
          subtitle="Read-only portal"
          sections={[{ items: [{ href: '/admin', label: 'Portal status' }, { href: '/game', label: 'Back to game' }] }]}
        />
      </aside>
      <main className="game-main stack">{children}</main>
    </div>
  );
}

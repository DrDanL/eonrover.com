'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import PlanetSidebar from '@/components/PlanetSidebar';
import StatusPanel from '@/components/StatusPanel';
import { useAuth } from '@/lib/AuthContext';

export default function GameLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading, error } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, router, user]);

  if (loading) {
    return (
      <main className="container public-main">
        <StatusPanel message="Reconnecting to command..." />
      </main>
    );
  }

  if (!user) {
    return (
      <main className="container public-main">
        <StatusPanel message="Redirecting to the sign-in uplink..." />
      </main>
    );
  }

  return (
    <div className="game-shell">
      <aside className="game-sidebar">
        <PlanetSidebar showAdminLink={user.role !== 'PLAYER'} />
      </aside>
      <main className="game-main stack">
        {error ? <StatusPanel tone="error" title="Auth warning" message={error} /> : null}
        {children}
      </main>
    </div>
  );
}

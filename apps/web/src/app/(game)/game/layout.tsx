'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import GameShell from '@/components/GameShell';
import StatusPanel from '@/components/StatusPanel';
import { useAuth } from '@/lib/AuthContext';
import { GameCommandProvider } from '@/lib/GameCommandContext';

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
    <GameCommandProvider>
      <GameShell user={user}>
        {error ? <StatusPanel tone="error" title="Auth warning" message={error} /> : null}
        {children}
      </GameShell>
    </GameCommandProvider>
  );
}

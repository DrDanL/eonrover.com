'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import StatusPanel from '@/components/StatusPanel';
import { useGameCommand } from '@/lib/GameCommandContext';

export default function GameDashboardPage() {
  const router = useRouter();
  const { summary, loading, error } = useGameCommand();

  useEffect(() => {
    if (summary?.selectedPlanetId) {
      router.replace(`/game/planets/${summary.selectedPlanetId}`);
    }
  }, [router, summary?.selectedPlanetId]);

  if (loading) return <StatusPanel message="Selecting your active planet…" />;
  if (error && !summary) return <StatusPanel tone="error" title="Command unavailable" message={error} />;
  if (summary && summary.ownedPlanets.length === 0) {
    return <StatusPanel title="No owned planets" message="No colony is available for this account." />;
  }
  return <StatusPanel message="Opening planetary overview…" />;
}

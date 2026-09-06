'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { planetSwitchPath } from '@eonrover/shared';
import GameNavigation from '@/components/GameNavigation';
import GameResourceBar from '@/components/GameResourceBar';
import StatusPanel from '@/components/StatusPanel';
import { apiPost } from '@/lib/api';
import { CurrentUser, useAuth } from '@/lib/AuthContext';
import { useGameCommand } from '@/lib/GameCommandContext';
import { formatCoords, formatDateTime, formatRelativeCountdown } from '@/lib/formatters';
import { getErrorMessage } from '@/lib/useApiData';

export default function GameShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { setUser } = useAuth();
  const { summary, loading, refreshing, stale, error, now, refresh } = useGameCommand();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const selected = summary?.selectedPlanet ?? null;
  const selectedPlanetId = summary?.selectedPlanetId ?? null;
  const construction = selected?.activeConstruction ?? null;
  const showAdminLink = user.role !== 'PLAYER';

  function switchPlanet(nextPlanetId: string) {
    if (!selectedPlanetId || nextPlanetId === selectedPlanetId) return;
    window.localStorage.setItem('eonrover:selected-planet', nextPlanetId);
    router.push(planetSwitchPath(pathname, selectedPlanetId, nextPlanetId));
  }

  async function logout() {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await apiPost('/api/auth/logout');
      setUser(null);
      router.replace('/login');
    } catch (logoutFailure) {
      setLogoutError(getErrorMessage(logoutFailure));
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="game-shell command-shell">
      <aside className="game-sidebar command-sidebar">
        <Link href={selectedPlanetId ? `/game/planets/${selectedPlanetId}` : '/game'} className="command-brand">
          <span className="command-brand-mark" aria-hidden="true">ER</span>
          <span><strong>Eon Rover</strong><small>Deep-space command</small></span>
        </Link>
        <GameNavigation planetId={selectedPlanetId} showAdminLink={showAdminLink} label="Primary game navigation" />
      </aside>

      <header className="command-header">
        <div className="command-mobile-menu">
          <Link href={selectedPlanetId ? `/game/planets/${selectedPlanetId}` : '/game'} className="command-mobile-brand">
            <span className="command-brand-mark" aria-hidden="true">ER</span>
            <strong>Eon Rover</strong>
          </Link>
          <details>
            <summary>Menu</summary>
            <GameNavigation planetId={selectedPlanetId} showAdminLink={showAdminLink} label="Mobile game navigation" />
          </details>
        </div>
        <label className="planet-selector">
          <span>Active planet</span>
          <select
            value={selectedPlanetId ?? ''}
            onChange={(event) => switchPlanet(event.target.value)}
            disabled={loading || !summary?.ownedPlanets.length}
          >
            {!summary?.ownedPlanets.length ? <option value="">No owned planets</option> : null}
            {summary?.ownedPlanets.map((planet) => (
              <option key={planet.id} value={planet.id}>
                {planet.name} {formatCoords(planet)}{planet.isHomeworld ? ' · Homeworld' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="command-account">
          <span><strong>{user.username}</strong><small>{user.role}</small></span>
          <Link href="/game/settings">Account</Link>
          <button type="button" onClick={logout} disabled={loggingOut}>
            {loggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </header>

      <section className="command-telemetry" aria-label="Planet command status">
        {selected && summary ? (
          <GameResourceBar planet={selected} serverTimestamp={summary.serverTimestamp} now={now} />
        ) : null}
        {construction && selectedPlanetId ? (
          <div className="global-construction" role="status">
            <span className="global-construction-signal" aria-hidden="true" />
            <div>
              <strong>{construction.buildingName} → level {construction.targetLevel}</strong>
              <span>
                {formatRelativeCountdown(construction.completesAt, now)} remaining · completes {formatDateTime(construction.completesAt)}
              </span>
            </div>
            <Link href={`/game/planets/${selectedPlanetId}/buildings`}>View construction</Link>
          </div>
        ) : selected ? (
          <div className="global-construction global-construction-empty">
            <span>Construction queue clear</span>
            <Link href={`/game/planets/${selectedPlanetId}/buildings`}>Review buildings</Link>
          </div>
        ) : null}
        {refreshing ? <p className="command-refreshing" role="status">Refreshing authoritative telemetry…</p> : null}
        {stale && error ? (
          <div className="command-stale alert alert-error" role="alert">
            <span>Telemetry refresh failed. The last safe snapshot remains visible and may be stale.</span>
            <button type="button" onClick={refresh}>Retry</button>
          </div>
        ) : null}
      </section>

      <main className="game-main command-main stack">
        {logoutError ? <StatusPanel tone="error" title="Sign out failed" message={logoutError} /> : null}
        {loading && !summary ? <StatusPanel message="Establishing planetary telemetry…" /> : null}
        {!loading && !summary && error ? <StatusPanel tone="error" title="Command summary unavailable" message={error} /> : null}
        {!loading && summary && summary.ownedPlanets.length === 0 ? (
          <StatusPanel title="No owned planets" message="This account has no planet available for command." />
        ) : null}
        {children}
      </main>
    </div>
  );
}

'use client';

import { FormEvent, useState } from 'react';
import ResourceBar from '@/components/ResourceBar';
import StatusPanel from '@/components/StatusPanel';
import { ApiError, apiGet } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { enumLabel, formatDateTime, formatDecimal, formatNumber, formatRelativeCountdown } from '@/lib/formatters';
import { getErrorMessage, useTicker } from '@/lib/useApiData';
import { AdminPlayerState, AdminUser } from '@/lib/web-types';

interface SearchResponse {
  users: AdminUser[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
}

const PAGE_SIZE = 20;

export default function AdminUsersPage() {
  const { user } = useAuth();
  const now = useTicker();
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [selected, setSelected] = useState<AdminPlayerState | null>(null);
  const [selectedPlanetId, setSelectedPlanetId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<{ title: string; message: string } | null>(null);

  async function searchPlayers(page: number, searchQuery = query) {
    const normalised = searchQuery.trim();
    if (normalised.length < 2 || normalised.length > 100) {
      setSearchError('Enter between 2 and 100 characters.');
      return;
    }

    setSearching(true);
    setSearchError(null);
    setDetailError(null);
    setSelected(null);
    setSelectedPlanetId(null);
    try {
      const response = await apiGet<SearchResponse>(
        `/api/admin/users?q=${encodeURIComponent(normalised)}&page=${page}&pageSize=${PAGE_SIZE}`,
      );
      setSubmittedQuery(normalised);
      setResults(response);
    } catch (error) {
      setResults(null);
      setSearchError(error instanceof ApiError && error.status === 403 ? 'Administrator access is required.' : getErrorMessage(error));
    } finally {
      setSearching(false);
    }
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void searchPlayers(1);
  }

  async function openPlayer(playerId: string) {
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const state = await apiGet<AdminPlayerState>(`/api/admin/users/${encodeURIComponent(playerId)}`);
      setSelected(state);
      setSelectedPlanetId(state.planets[0]?.id ?? null);
    } catch (error) {
      setSelected(null);
      setSelectedPlanetId(null);
      if (error instanceof ApiError && error.status === 404) {
        setDetailError({ title: 'Player not found', message: 'This player is no longer available.' });
      } else if (error instanceof ApiError && error.status === 403) {
        setDetailError({ title: 'Permission denied', message: 'Administrator access is required.' });
      } else {
        setDetailError({ title: 'Unable to load player state', message: getErrorMessage(error) });
      }
    } finally {
      setLoadingDetail(false);
    }
  }

  if (user?.role !== 'ADMIN') {
    return <StatusPanel tone="error" title="Permission denied" message="Administrator access is required to inspect player state." />;
  }

  const planet = selected?.planets.find((entry) => entry.id === selectedPlanetId) ?? selected?.planets[0];

  return (
    <section className="stack">
      <div className="panel stack">
        <h1 style={{ margin: 0 }}>Player state</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
          Search for an account and inspect its current server-authoritative state. This view is read-only.
        </p>
      </div>

      <form className="panel stack" onSubmit={handleSearch}>
        <label htmlFor="player-search">Username, email or exact player ID</label>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <input
            id="player-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            minLength={2}
            maxLength={100}
            autoComplete="off"
            style={{ flex: '1 1 16rem' }}
          />
          <button type="submit" className="btn btn-primary" disabled={searching}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>
      </form>

      {searchError ? <StatusPanel tone="error" title="Unable to search" message={searchError} /> : null}
      {!searching && !searchError && results === null ? <StatusPanel message="Enter at least two characters to find a player." /> : null}
      {searching ? <StatusPanel message="Searching players…" /> : null}
      {!searching && results?.users.length === 0 ? <StatusPanel title="No players found" message="No accounts matched that search." /> : null}

      {!searching && results && results.users.length > 0 ? (
        <div className="panel stack">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>Search results</h2>
            <span style={{ color: 'var(--color-text-muted)' }}>
              {formatNumber(results.pagination.total)} result{results.pagination.total === 1 ? '' : 's'}
            </span>
          </div>
          {results.users.map((entry) => (
            <article className="panel stack" key={entry.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <strong>{entry.username}</strong>
                  <p style={{ margin: 0, color: 'var(--color-text-muted)', overflowWrap: 'anywhere' }}>{entry.email}</p>
                </div>
                <div className="cta-row">
                  <span className="tag">{entry.role}</span>
                  <span className="tag">{enumLabel(entry.status)}</span>
                  <span className="tag">{entry.emailVerified ? 'Verified' : 'Unverified'}</span>
                </div>
              </div>
              <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
                Created {formatDateTime(entry.createdAt)} · {formatNumber(entry.planetCount)} planet{entry.planetCount === 1 ? '' : 's'}
              </p>
              <div>
                <button type="button" onClick={() => void openPlayer(entry.id)} disabled={loadingDetail}>
                  Inspect player state
                </button>
              </div>
            </article>
          ))}
          <div className="cta-row" style={{ justifyContent: 'space-between' }} aria-label="Search result pages">
            <button
              type="button"
              disabled={!results.pagination.hasPrevious || searching}
              onClick={() => void searchPlayers(results.pagination.page - 1, submittedQuery)}
            >
              Previous
            </button>
            <span>
              Page {results.pagination.page} of {results.pagination.totalPages}
            </span>
            <button
              type="button"
              disabled={!results.pagination.hasNext || searching}
              onClick={() => void searchPlayers(results.pagination.page + 1, submittedQuery)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      {loadingDetail ? <StatusPanel message="Loading authoritative player state…" /> : null}
      {detailError ? <StatusPanel tone="error" title={detailError.title} message={detailError.message} /> : null}

      {!loadingDetail && selected ? (
        <div className="stack">
          <article className="panel stack">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: 0 }}>{selected.player.username}</h2>
                <p style={{ margin: 0, color: 'var(--color-text-muted)', overflowWrap: 'anywhere' }}>{selected.player.email}</p>
              </div>
              <div className="cta-row">
                <span className="tag">{selected.player.role}</span>
                <span className="tag">{enumLabel(selected.player.status)}</span>
                <span className="tag">{selected.player.emailVerified ? 'Verified' : 'Unverified'}</span>
              </div>
            </div>
            <div className="grid grid-cards">
              <div><strong>Player ID</strong><p style={{ overflowWrap: 'anywhere' }}>{selected.player.id}</p></div>
              <div><strong>Created</strong><p>{formatDateTime(selected.player.createdAt)}</p></div>
              <div><strong>Protected until</strong><p>{formatDateTime(selected.player.protectedUntil)}</p></div>
              <div><strong>Planets</strong><p>{formatNumber(selected.player.planetCount)}</p></div>
              <div><strong>Active sessions</strong><p>{formatNumber(selected.player.activeSessionCount)}</p></div>
              <div><strong>Unread notifications</strong><p>{formatNumber(selected.player.unreadNotificationCount)}</p></div>
            </div>
          </article>

          {selected.planets.length === 0 ? <StatusPanel title="No planets" message="This player does not own a planet." /> : null}
          {selected.planets.length > 1 ? (
            <div className="panel stack">
              <label htmlFor="admin-planet-select">Planet</label>
              <select id="admin-planet-select" value={planet?.id ?? ''} onChange={(event) => setSelectedPlanetId(event.target.value)}>
                {selected.planets.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name} [{entry.galaxy}:{entry.system}:{entry.position}]
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {planet ? (
            <article className="stack">
              <div className="panel stack">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <h2 style={{ margin: 0 }}>{planet.name}</h2>
                    <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
                      [{planet.galaxy}:{planet.system}:{planet.position}] · {enumLabel(planet.planetType)}
                    </p>
                  </div>
                  {planet.isHomeworld ? <span className="tag">Homeworld</span> : null}
                </div>
                <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
                  Temperature {formatNumber(planet.environment.temperature)}° · Solar index {formatDecimal(planet.environment.solarIndex)} · Produced through {formatDateTime(planet.lastProductionAt)}
                </p>
              </div>

              <ResourceBar resources={planet.resources} storage={planet.storage} production={planet.production} />

              <div className="grid grid-cards">
                <div className="panel stack">
                  <h3 style={{ margin: 0 }}>Energy</h3>
                  <p style={{ margin: 0 }}>Supply: {formatDecimal(planet.energy.supply)}</p>
                  <p style={{ margin: 0 }}>Demand: {formatDecimal(planet.energy.demand)}</p>
                  <p style={{ margin: 0 }}>Efficiency: {formatDecimal(planet.energy.efficiency * 100)}%</p>
                </div>
                <div className="panel stack">
                  <h3 style={{ margin: 0 }}>Storage capacity</h3>
                  <p style={{ margin: 0 }}>Alloy: {formatNumber(planet.storage.alloy)}</p>
                  <p style={{ margin: 0 }}>Heliox: {formatNumber(planet.storage.heliox)}</p>
                  <p style={{ margin: 0 }}>Aether: {formatNumber(planet.storage.aether)}</p>
                </div>
                <div className="panel stack">
                  <h3 style={{ margin: 0 }}>Active construction</h3>
                  {planet.activeConstruction ? (
                    <div className="stack" style={{ gap: '0.35rem' }}>
                      <p style={{ margin: 0 }}>{enumLabel(planet.activeConstruction.buildingKey)} to level {planet.activeConstruction.targetLevel}</p>
                      <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
                        Completes in {formatRelativeCountdown(planet.activeConstruction.completesAt, now)} ({formatDateTime(planet.activeConstruction.completesAt)})
                      </p>
                    </div>
                  ) : <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No active building construction.</p>}
                </div>
              </div>

              <div className="panel stack">
                <h3 style={{ margin: 0 }}>Completed building levels</h3>
                {planet.buildings.length === 0 ? <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No completed buildings.</p> : (
                  <div className="grid grid-cards">
                    {planet.buildings.map((building) => (
                      <div key={building.key}>
                        <strong>{enumLabel(building.key)}</strong>
                        <p style={{ marginBottom: 0 }}>Level {formatNumber(building.level)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

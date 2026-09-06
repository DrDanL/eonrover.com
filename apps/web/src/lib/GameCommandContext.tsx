'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { planetIdFromGamePath } from '@eonrover/shared';
import { ApiError, apiGet } from '@/lib/api';
import { CommandSummaryResponse } from '@/lib/web-types';
import { getErrorMessage } from '@/lib/useApiData';

const COMMAND_REFRESH_EVENT = 'eonrover:command-refresh';
const SELECTED_PLANET_STORAGE_KEY = 'eonrover:selected-planet';
const AUTHORITATIVE_REFRESH_MS = 60_000;
const OVERDUE_RETRY_MS = 5_000;

interface GameCommandState {
  summary: CommandSummaryResponse | null;
  loading: boolean;
  refreshing: boolean;
  stale: boolean;
  error: string | null;
  now: number;
  refresh: () => void;
}

const GameCommandContext = createContext<GameCommandState | null>(null);

export function requestCommandSummaryRefresh(): void {
  window.dispatchEvent(new Event(COMMAND_REFRESH_EVENT));
}

export function GameCommandProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [summary, setSummary] = useState<CommandSummaryResponse | null>(null);
  const summaryRef = useRef<CommandSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [visible, setVisible] = useState(true);
  const [now, setNow] = useState(0);
  const requestSequence = useRef(0);
  const lastOverdueRefresh = useRef(0);

  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    const routePlanetId = planetIdFromGamePath(pathname);
    const storedPlanetId = routePlanetId ? null : window.localStorage.getItem(SELECTED_PLANET_STORAGE_KEY);
    const requestedPlanetId = routePlanetId ?? storedPlanetId;
    const hasSafeDisplay = summaryRef.current !== null;
    setLoading(!hasSafeDisplay || Boolean(routePlanetId && summaryRef.current?.selectedPlanetId !== routePlanetId));
    setRefreshing(hasSafeDisplay);
    setError(null);

    async function fetchSummary(planetId: string | null): Promise<CommandSummaryResponse> {
      const query = planetId ? `?planetId=${encodeURIComponent(planetId)}` : '';
      return apiGet<CommandSummaryResponse>(`/api/planets/command-summary${query}`);
    }

    async function load() {
      try {
        let result: CommandSummaryResponse;
        try {
          result = await fetchSummary(requestedPlanetId);
        } catch (requestError) {
          if (requestError instanceof ApiError && requestError.status === 404 && !routePlanetId && storedPlanetId) {
            window.localStorage.removeItem(SELECTED_PLANET_STORAGE_KEY);
            result = await fetchSummary(null);
          } else {
            throw requestError;
          }
        }
        if (sequence !== requestSequence.current) return;
        summaryRef.current = result;
        setSummary(result);
        setStale(false);
        setError(null);
        if (result.selectedPlanetId) {
          window.localStorage.setItem(SELECTED_PLANET_STORAGE_KEY, result.selectedPlanetId);
        } else {
          window.localStorage.removeItem(SELECTED_PLANET_STORAGE_KEY);
        }
      } catch (requestError) {
        if (sequence !== requestSequence.current) return;
        if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) {
          summaryRef.current = null;
          setSummary(null);
          setStale(false);
          setError(getErrorMessage(requestError));
          return;
        }
        setError(getErrorMessage(requestError));
        setStale(summaryRef.current !== null);
      } finally {
        if (sequence === requestSequence.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void load();
  }, [pathname, version]);

  useEffect(() => {
    function handleVisibility() {
      const isVisible = document.visibilityState === 'visible';
      setVisible(isVisible);
      if (isVisible) {
        setNow(Date.now());
        refresh();
      }
    }
    setVisible(document.visibilityState === 'visible');
    setNow(Date.now());
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [refresh]);

  useEffect(() => {
    if (!visible) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    const timer = window.setInterval(refresh, AUTHORITATIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh, visible]);

  useEffect(() => {
    const handleRefresh = () => refresh();
    window.addEventListener(COMMAND_REFRESH_EVENT, handleRefresh);
    return () => window.removeEventListener(COMMAND_REFRESH_EVENT, handleRefresh);
  }, [refresh]);

  useEffect(() => {
    const construction = summary?.selectedPlanet?.activeConstruction;
    if (!construction || !visible || now < Date.parse(construction.completesAt)) {
      if (!construction) lastOverdueRefresh.current = 0;
      return;
    }
    if (now - lastOverdueRefresh.current < OVERDUE_RETRY_MS) return;
    lastOverdueRefresh.current = now;
    refresh();
  }, [now, refresh, summary, visible]);

  const value = useMemo(
    () => ({ summary, loading, refreshing, stale, error, now, refresh }),
    [summary, loading, refreshing, stale, error, now, refresh],
  );

  return <GameCommandContext.Provider value={value}>{children}</GameCommandContext.Provider>;
}

export function useGameCommand(): GameCommandState {
  const context = useContext(GameCommandContext);
  if (!context) throw new Error('useGameCommand must be used within GameCommandProvider');
  return context;
}

'use client';

import { useCallback } from 'react';
import SidebarNav from '@/components/SidebarNav';
import StatusPanel from '@/components/StatusPanel';
import { useApiData } from '@/lib/useApiData';
import { apiGet } from '@/lib/api';
import { PlanetSummary } from '@/lib/web-types';
import { formatCoords } from '@/lib/formatters';

export default function PlanetSidebar({ showAdminLink }: { showAdminLink: boolean }) {
  const loadPlanets = useCallback(() => apiGet<{ planets: PlanetSummary[] }>('/api/planets'), []);
  const { data, loading, error } = useApiData(loadPlanets);

  const sections = [
    {
      items: [
        { href: '/game', label: 'Command' },
        { href: '/game/galaxy', label: 'Galaxy' },
        { href: '/game/gates', label: 'Eon Gates' },
        { href: '/game/messages', label: 'Messages' },
        { href: '/game/alliances', label: 'Alliances' },
        { href: '/game/leaderboard', label: 'Leaderboard' },
        { href: '/game/notifications', label: 'Notifications' },
        { href: '/game/settings', label: 'Settings' },
        { href: '/game/reports', label: 'Reports' },
        ...(showAdminLink ? [{ href: '/admin', label: 'Admin' }] : []),
      ],
    },
  ];

  const planetSection = data?.planets.length
    ? [
        {
          heading: 'Planets',
          items: data.planets.map((planet) => ({
            href: `/game/planets/${planet.id}`,
            label: `${planet.name} ${formatCoords(planet)}`,
          })),
        },
      ]
    : [];

  return (
    <div className="stack">
      <SidebarNav title="Eon Rover" subtitle="Operations uplink" sections={[...sections, ...planetSection]} />
      {loading ? <StatusPanel message="Loading colonies..." /> : null}
      {!loading && error ? <StatusPanel tone="error" title="Sidebar offline" message={error} /> : null}
      {!loading && !error && data && data.planets.length === 0 ? (
        <StatusPanel message="No colonies found yet." />
      ) : null}
    </div>
  );
}

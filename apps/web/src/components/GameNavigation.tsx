'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface GameNavigationProps {
  planetId: string | null;
  showAdminLink: boolean;
  label: string;
}

interface NavigationItem {
  label: string;
  href?: string;
  activePath?: string;
  status?: string;
}

export default function GameNavigation({ planetId, showAdminLink, label }: GameNavigationProps) {
  const pathname = usePathname();
  const planetBase = planetId ? `/game/planets/${planetId}` : null;
  const primary: NavigationItem[] = [
    { label: 'Overview', href: planetBase ?? undefined, status: planetBase ? undefined : 'No planet' },
    { label: 'Buildings', href: planetBase ? `${planetBase}/buildings` : undefined, status: planetBase ? undefined : 'No planet' },
    { label: 'Research', href: planetBase ? `${planetBase}/research` : undefined, status: planetBase ? undefined : 'No planet' },
    { label: 'Shipyard', href: planetBase ? `${planetBase}/shipyard` : undefined, status: planetBase ? undefined : 'No planet' },
    { label: 'Fleet', href: planetBase ? `${planetBase}/fleet` : undefined, status: planetBase ? undefined : 'No planet' },
    { label: 'Galaxy', href: '/game/galaxy' },
    { label: 'Messages', href: '/game/messages' },
    { label: 'Alliance', href: '/game/alliances' },
  ];
  const secondary: NavigationItem[] = [
    { label: 'Eon Gates', href: '/game/gates' },
    { label: 'Mission Control', href: '/game/operations' },
    { label: 'Reports', href: '/game/reports' },
    { label: 'Leaderboard', href: '/game/leaderboard' },
    { label: 'Notifications', href: '/game/notifications' },
    { label: 'Settings', href: '/game/settings' },
    ...(showAdminLink ? [{ label: 'Administrator', href: '/admin' }] : []),
  ];

  function isActive(item: NavigationItem): boolean {
    if (item.activePath) return pathname === item.activePath || pathname.startsWith(`${item.activePath}/`);
    if (!item.href) return false;
    if (item.label === 'Overview') return pathname === item.href;
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  function renderItems(items: NavigationItem[]) {
    return items.map((item) => (
      <li key={item.label}>
        {item.href ? (
          <Link
            href={item.href}
            aria-current={isActive(item) ? 'page' : undefined}
            onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}
          >
            <span>{item.label}</span>
          </Link>
        ) : (
          <span
            className={`command-nav-disabled${isActive(item) ? ' command-nav-current' : ''}`}
            aria-disabled="true"
            aria-current={isActive(item) ? 'page' : undefined}
          >
            <span>{item.label}</span>
            <small>{item.status}</small>
          </span>
        )}
      </li>
    ));
  }

  return (
    <nav className="command-navigation" aria-label={label}>
      <p className="command-nav-heading">Command</p>
      <ul>{renderItems(primary)}</ul>
      <p className="command-nav-heading">Operations</p>
      <ul>{renderItems(secondary)}</ul>
    </nav>
  );
}

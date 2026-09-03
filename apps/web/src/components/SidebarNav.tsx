'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SidebarNavItem {
  href: string;
  label: string;
}

interface SidebarNavProps {
  title: string;
  subtitle?: string;
  sections: Array<{
    heading?: string;
    items: SidebarNavItem[];
  }>;
}

export default function SidebarNav({ title, subtitle, sections }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <>
      <div>
        <div className="brand">{title}</div>
        {subtitle ? <p style={{ color: 'var(--color-text-muted)', marginBottom: 0 }}>{subtitle}</p> : null}
      </div>
      {sections.map((section, index) => (
        <div className="sidebar-section" key={`${section.heading ?? 'section'}-${index}`}>
          {section.heading ? <div className="sidebar-heading">{section.heading}</div> : null}
          <nav aria-label={section.heading ?? title}>
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link key={item.href} href={item.href} className={active ? 'sidebar-link-active' : undefined}>
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      ))}
    </>
  );
}

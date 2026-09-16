import Link from 'next/link';
import StatusPanel from '@/components/StatusPanel';
import AdminPortalLayoutClient from '@/components/AdminPortalLayoutClient';
import { isAdminPortalRuntimeEnabled } from '@/lib/adminPortalPolicy';

export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isAdminPortalRuntimeEnabled()) {
    return (
      <main className="container public-main stack">
        <StatusPanel tone="error" title="Administrator portal unavailable" message="This portal is unavailable." />
        <Link href="/game" className="btn">Return to game</Link>
      </main>
    );
  }

  return <AdminPortalLayoutClient>{children}</AdminPortalLayoutClient>;
}

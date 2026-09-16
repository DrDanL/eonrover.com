import StatusPanel from '@/components/StatusPanel';

export default function AdminDashboardPage() {
  return (
    <section className="stack">
      <div className="panel stack">
        <h1 style={{ margin: 0 }}>Administrator portal</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
          Read-only management is being introduced. No player, queue, runtime, security, or audit data is available here.
        </p>
      </div>
      <StatusPanel message="No management actions are available." />
    </section>
  );
}

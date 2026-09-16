import StatusPanel from '@/components/StatusPanel';

export default function AdminPortalUnavailable() {
  return (
    <section className="stack">
      <StatusPanel
        title="Management unavailable"
        message="This management area is not available in the read-only administrator portal."
      />
    </section>
  );
}

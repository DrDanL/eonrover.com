export default function TermsPage() {
  return (
    <section className="stack" style={{ padding: '2rem 0 4rem' }}>
      <div className="panel stack">
        <h1 style={{ margin: 0 }}>Terms of Service</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
          Play fairly, respect other players, and do not interfere with the service or attempt to access accounts that are not yours.
        </p>
      </div>
      <div className="panel stack">
        <h2 style={{ margin: 0 }}>Fair play</h2>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Automation, harassment, fraud, and abuse of bugs for competitive gain can lead to suspension or permanent removal.</p>
        <h2 style={{ margin: 0 }}>Account responsibility</h2>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Keep your credentials private. You are responsible for activity that occurs under your account until you report a compromise.</p>
        <h2 style={{ margin: 0 }}>Service changes</h2>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Universe settings, balance, and features may evolve as Eon Rover grows. Major changes will be announced in the news feed when possible.</p>
      </div>
    </section>
  );
}

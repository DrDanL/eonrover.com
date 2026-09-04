export default function PrivacyPage() {
  return (
    <section className="stack" style={{ padding: '2rem 0 4rem' }}>
      <div className="panel stack">
        <h1 style={{ margin: 0 }}>Privacy Policy</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Eon Rover stores the minimum account and gameplay data needed to run the universe, secure access, and support moderation.</p>
      </div>
      <div className="panel stack">
        <h2 style={{ margin: 0 }}>What we keep</h2>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Account details, session data, messages, reports, and gameplay events are retained so the world can function and moderators can investigate abuse.</p>
        <h2 style={{ margin: 0 }}>Why we keep it</h2>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>We use this information to authenticate players, process in-game actions, send account emails, and maintain service integrity.</p>
        <h2 style={{ margin: 0 }}>Support contact</h2>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>For privacy questions, contact support@eonrover.com.</p>
      </div>
    </section>
  );
}

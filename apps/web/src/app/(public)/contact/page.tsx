export default function ContactPage() {
  return (
    <section className="stack" style={{ padding: '2rem 0 4rem' }}>
      <div className="panel stack">
        <h1 style={{ margin: 0 }}>Contact</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Need account help, moderation support, or technical assistance? Reach the crew below.</p>
      </div>
      <div className="panel stack">
        <h2 style={{ margin: 0 }}>Support</h2>
        <p style={{ margin: 0 }}><a href="mailto:support@eonrover.com">support@eonrover.com</a></p>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Include your username and a short description of the issue so the team can respond faster.</p>
      </div>
    </section>
  );
}

const sections = [
  {
    title: 'Resources first',
    body: 'Alloy funds most construction, Heliox drives logistics and fuel, and Aether unlocks advanced technology. Keep extraction, storage, and energy in balance so nothing bottlenecks your opening hours.',
  },
  {
    title: 'Buildings set the pace',
    body: 'Upgrade mines for throughput, storage for headroom, solar arrays for stable power, and your shipyard plus research lab when you are ready to widen your options.',
  },
  {
    title: 'Research is account-wide',
    body: 'Technologies improve every colony and fleet under your command. Prioritise propulsion, economy boosts, and survivability based on whether you want growth, scouting, or combat pressure.',
  },
  {
    title: 'Fleets are logistics puzzles',
    body: 'Sending a mission consumes ships, cargo space, and Heliox. Launch only what you can afford to keep away from home, especially while your industry is still small.',
  },
  {
    title: 'Eon Gates are a long-term goal',
    body: 'Gate Observatories and Gate Theory lead toward the hidden Eon network. Treat them as a strategic horizon while your core economy and defence stay healthy.',
  },
];

export default function GuidePage() {
  return (
    <section className="stack" style={{ padding: '2rem 0 4rem' }}>
      <div className="panel stack">
        <h1 style={{ margin: 0 }}>Beginner&apos;s Guide</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
          Start small, secure stable production, then expand into research and fleets once your first colony can support them.
        </p>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        {sections.map((section) => (
          <article className="panel stack" key={section.title}>
            <h2 style={{ margin: 0 }}>{section.title}</h2>
            <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>{section.body}</p>
          </article>
        ))}
      </div>
      <div className="panel stack">
        <h2 style={{ marginTop: 0 }}>Opening checklist</h2>
        <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
          <li>Raise Alloy and Heliox income before chasing expensive technology.</li>
          <li>Watch storage caps so production does not overflow.</li>
          <li>Keep solar output ahead of industrial energy demand.</li>
          <li>Research with a colony that has enough resources to finish the job.</li>
          <li>Scout carefully before committing combat fleets.</li>
        </ul>
      </div>
    </section>
  );
}

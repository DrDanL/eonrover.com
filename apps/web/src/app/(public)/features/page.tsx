export default function FeaturesPage() {
  const features = [
    {
      title: 'Living colonies',
      body: 'Grow multiple worlds with distinct climates, storage ceilings, and energy balances that shape your industrial choices.',
    },
    {
      title: 'Layered progression',
      body: 'Push from raw extraction into research, fleet engineering, defences, and late-game Eon Gate discovery at your own pace.',
    },
    {
      title: 'Meaningful logistics',
      body: 'Every flight asks you to think about cargo, speed, fuel burn, and timing before your task force leaves orbit.',
    },
    {
      title: 'Player diplomacy',
      body: 'Trade intel through messages, form alliances, and coordinate expansion across crowded systems.',
    },
    {
      title: 'Persistent universe',
      body: 'Production continues over time, queues advance in the background, and the galaxy evolves with every commander who joins.',
    },
    {
      title: 'Readable strategy UI',
      body: 'Track resources, queues, reports, and rankings from a clean command interface built for long-form play sessions.',
    },
  ];

  return (
    <section className="stack" style={{ padding: '2rem 0 4rem' }}>
      <div className="hero">
        <h1>Build a frontier that keeps moving after you log off.</h1>
        <p>
          Eon Rover blends colony management, research planning, and fleet timing into an original browser strategy experience set in a fractured deep-space network.
        </p>
      </div>
      <div className="grid grid-cards">
        {features.map((feature) => (
          <article className="panel stack" key={feature.title}>
            <h2 style={{ margin: 0 }}>{feature.title}</h2>
            <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>{feature.body}</p>
          </article>
        ))}
      </div>
      <div className="panel stack">
        <h2 style={{ marginTop: 0 }}>What makes Eon Rover distinct?</h2>
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
          Instead of copying legacy space games, Eon Rover focuses on energy discipline, flexible logistics, and the mystery of the Eon Gates. Your empire grows from practical industrial choices rather than scripted paths.
        </p>
      </div>
    </section>
  );
}

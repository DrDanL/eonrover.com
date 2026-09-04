import Link from 'next/link';
import PublicNav from '@/components/PublicNav';
import PublicFooter from '@/components/PublicFooter';

export default function HomePage() {
  return (
    <>
      <PublicNav />
      <main className="container">
        <section className="hero">
          <p className="tag" style={{ marginBottom: '1rem' }}>
            Now recruiting commanders for the Eon Reach
          </p>
          <h1>Command a civilisation across the Eon Reach.</h1>
          <p>
            Eon Rover is a persistent, browser-based space strategy game. Mine <span className="resource-alloy">Alloy</span>,
            harvest <span className="resource-heliox">Heliox</span>, and refine <span className="resource-aether">Aether</span> to
            build fleets, research technology, and uncover the ancient Eon Gates &mdash; ruined gateways that once linked distant
            systems.
          </p>
          <div className="cta-row">
            <Link href="/register" className="btn btn-primary">
              Start your empire
            </Link>
            <Link href="/guide" className="btn">
              Read the beginner&apos;s guide
            </Link>
          </div>
        </section>

        <section className="grid grid-cards" aria-label="Game pillars">
          <div className="panel">
            <h2>Build</h2>
            <p>Grow mines, storage, and a shipyard on worlds shaped by temperature, solar exposure and planet type.</p>
          </div>
          <div className="panel">
            <h2>Research</h2>
            <p>Unlock propulsion, weapons, shields and Gate Theory in a laboratory that accelerates every future project.</p>
          </div>
          <div className="panel">
            <h2>Explore</h2>
            <p>Send probes and scouts across the galaxy map, colonise new worlds, and recover Eon Gate fragments.</p>
          </div>
          <div className="panel">
            <h2>Command fleets</h2>
            <p>Transport, deploy, raid, attack, recycle debris, and defend your systems in server-authoritative combat.</p>
          </div>
        </section>

        <section className="panel" style={{ marginTop: '3rem' }}>
          <h2>The Eon Gates</h2>
          <p>
            Ancient, abandoned gateways lie dormant across the Reach. Explorers can recover gate fragments, researchers can
            decode Gate Theory, and Gate Observatories can eventually stabilise a route between distant systems &mdash; a
            powerful shortcut that also reveals your position to rivals watching the network.
          </p>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}

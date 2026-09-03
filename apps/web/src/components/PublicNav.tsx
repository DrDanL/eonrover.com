import Link from 'next/link';

export default function PublicNav() {
  return (
    <header className="container">
      <div className="site-nav">
        <Link href="/" className="brand">
          🛰️ EON ROVER
        </Link>
        <nav className="links" aria-label="Primary">
          <Link href="/features">Features</Link>
          <Link href="/guide">Beginner&apos;s Guide</Link>
          <Link href="/news">News</Link>
          <Link href="/stats">Universe Stats</Link>
          <Link href="/leaderboard">Leaderboard</Link>
        </nav>
        <nav className="links" aria-label="Account">
          <Link href="/login">Sign in</Link>
          <Link href="/register" className="btn btn-primary">
            Play now
          </Link>
        </nav>
      </div>
    </header>
  );
}

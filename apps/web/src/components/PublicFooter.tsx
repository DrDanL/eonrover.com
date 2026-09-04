import Link from 'next/link';

export default function PublicFooter() {
  return (
    <footer className="container" style={{ padding: '3rem 0', color: 'var(--color-text-muted)' }}>
      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.5rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <span>&copy; {new Date().getFullYear()} Eon Rover. All rights reserved.</span>
        <nav style={{ display: 'flex', gap: '1.25rem' }}>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/contact">Contact</Link>
        </nav>
      </div>
    </footer>
  );
}

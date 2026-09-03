import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/AuthContext';
import Starfield from '@/components/Starfield';

export const metadata: Metadata = {
  title: 'Eon Rover — a deep-space strategy MMO',
  description:
    'Colonise the Eon Reach: build planets, research technology, launch fleets, and uncover the Eon Gates in this browser-based space strategy game.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Starfield />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

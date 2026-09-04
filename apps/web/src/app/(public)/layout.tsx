import PublicFooter from '@/components/PublicFooter';
import PublicNav from '@/components/PublicNav';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PublicNav />
      <main className="container public-main">{children}</main>
      <PublicFooter />
    </>
  );
}

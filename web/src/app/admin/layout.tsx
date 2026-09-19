import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { signOut } from '@/app/login/actions';
import { btnGhost } from '@/components/ui';
import { LiveRefresh } from '@/components/live-refresh';
import { ThemeToggle } from '@/components/theme-toggle';
import { getTheme } from '@/lib/theme';

// Shared by the merchant list and every per-shop page, so the header and the live subscription are set up once.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [{ user }, theme] = await Promise.all([requireAdmin(), getTheme()]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <Link href="/admin" className="flex items-center">
            <span className="text-lg font-semibold">ChatNab</span>
            <span className="ml-2 rounded-chip bg-foreground px-1.5 py-0.5 text-xs font-medium text-background">Admin</span>
          </Link>
          <div className="flex items-center gap-1 text-sm text-zinc-500">
            <ThemeToggle theme={theme} />
            <form action={signOut} className="flex items-center gap-3">
              <span className="hidden sm:inline">{user.email}</span>
              <button className={btnGhost}>Sign out</button>
            </form>
          </div>
        </div>
      </header>

      <LiveRefresh />
      {children}
    </div>
  );
}

import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { signOut } from '@/app/login/actions';
import { btnGhost } from '@/components/ui';
import { LiveRefresh } from '@/components/live-refresh';

// Shared by the merchant list and every per-shop page, so the header and the live subscription are set up once.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdmin();

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <Link href="/admin" className="flex items-center">
            <span className="text-lg font-semibold">ChatNab</span>
            <span className="ml-2 rounded bg-zinc-900 px-1.5 py-0.5 text-xs font-medium text-white">Admin</span>
          </Link>
          <form action={signOut} className="flex items-center gap-3 text-sm text-zinc-500">
            <span className="hidden sm:inline">{user.email}</span>
            <button className={btnGhost}>Sign out</button>
          </form>
        </div>
      </header>

      <LiveRefresh />
      {children}
    </div>
  );
}

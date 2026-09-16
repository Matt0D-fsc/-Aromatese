import Link from 'next/link';
import { requireMerchant } from '@/lib/auth';
import { signOut } from '@/app/login/actions';
import { btnGhost } from '@/components/ui';
import { LiveRefresh } from '@/components/live-refresh';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { supabase, tenant, user } = await requireMerchant();
  const { count: needsYou } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .eq('needs_human', true);

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex flex-wrap items-center gap-6">
            <span className="text-lg font-semibold">{tenant.name}</span>
            <nav className="flex gap-4 text-sm text-zinc-600">
              <Link href="/dashboard" className="hover:text-zinc-900">Products</Link>
              <Link href="/dashboard/chats" className="hover:text-zinc-900">
                Chats
                {!!needsYou && <span className="ml-1 rounded-full bg-amber-500 px-1.5 py-0.5 text-[11px] font-semibold text-white">{needsYou}</span>}
              </Link>
              <Link href="/dashboard/orders" className="hover:text-zinc-900">Orders</Link>
              <Link href="/dashboard/onboarding" className="hover:text-zinc-900">Shop profile</Link>
              <Link href={`/chat/${tenant.slug}`} target="_blank" className="font-medium text-zinc-900 hover:underline">AI chat ↗</Link>
            </nav>
          </div>
          <form action={signOut} className="flex items-center gap-3 text-sm text-zinc-500">
            {user.email}
            <button className={btnGhost}>Sign out</button>
          </form>
        </div>
      </header>

      {tenant.status === 'suspended' && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-700">
          Your shop is suspended. You can view your data, but changes and AI replies are paused. Contact the ChatNab team.
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <LiveRefresh tenantId={tenant.id} />
    </div>
  );
}

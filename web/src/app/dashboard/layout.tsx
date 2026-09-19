import Link from 'next/link';
import { requireMerchant } from '@/lib/auth';
import { signOut } from '@/app/login/actions';
import { btnGhost } from '@/components/ui';
import { LiveRefresh } from '@/components/live-refresh';
import { LanguageToggle } from '@/components/language-toggle';
import { BottomTabs, TopNav, type NavLink } from '@/components/dashboard-nav';
import { t } from '@/lib/i18n';
import { getLang } from '@/lib/i18n-server';
import { ThemeToggle } from '@/components/theme-toggle';
import { getTheme } from '@/lib/theme';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [{ supabase, tenant, user }, lang, theme] = await Promise.all([requireMerchant(), getLang(), getTheme()]);
  const { count: needsYou } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .eq('needs_human', true);

  // Five on a phone, the full set on a laptop: Customers and Team are looked up occasionally, not daily.
  const tabs: NavLink[] = [
    { href: '/dashboard', label: t(lang, 'nav.home'), icon: 'home' },
    { href: '/dashboard/chats', label: t(lang, 'nav.chats'), icon: 'chats', badge: needsYou ?? 0 },
    { href: '/dashboard/orders', label: t(lang, 'nav.orders'), icon: 'orders' },
    { href: '/dashboard/products', label: t(lang, 'nav.products'), icon: 'products' },
    { href: '/dashboard/analytics', label: t(lang, 'nav.analytics'), icon: 'analytics' },
  ];
  const links: NavLink[] = [
    ...tabs,
    { href: '/dashboard/customers', label: t(lang, 'nav.customers'), icon: 'customers' },
    { href: '/dashboard/ai', label: t(lang, 'nav.ai'), icon: 'chats' },
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/85 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
            {tenant.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tenant.logo_url} alt="" className="h-8 w-8 shrink-0 rounded-full border border-line object-cover" />
            )}
            <span className="truncate text-lg font-semibold">{tenant.name}</span>
          </Link>
          <div className="flex shrink-0 items-center gap-1 text-sm text-zinc-500">
            <ThemeToggle theme={theme} />
            <form action={signOut} className="flex items-center gap-2">
              <LanguageToggle lang={lang} />
              <span className="hidden md:inline">{user.email}</span>
              <button className={btnGhost}>{t(lang, 'nav.signOut')}</button>
            </form>
          </div>
        </div>

        <TopNav links={[...links, { href: '/dashboard/staff', label: t(lang, 'nav.team'), icon: 'customers' }]} />
      </header>

      {tenant.status === 'suspended' && (
        <div className="border-b border-danger/25 bg-danger-soft px-4 py-3 text-center text-sm text-danger-strong">{t(lang, 'suspended')}</div>
      )}

      {/* The tab bar is fixed over the page on a phone, so the last card needs room to clear it. */}
      <main className="mx-auto max-w-6xl px-4 py-6 pb-24 sm:py-8 sm:pb-8">{children}</main>

      <BottomTabs links={tabs} />
      <LiveRefresh tenantId={tenant.id} />
    </div>
  );
}

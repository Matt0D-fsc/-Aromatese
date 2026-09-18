import Link from 'next/link';
import { requireMerchant } from '@/lib/auth';
import { signOut } from '@/app/login/actions';
import { btnGhost } from '@/components/ui';
import { LiveRefresh } from '@/components/live-refresh';
import { LanguageToggle } from '@/components/language-toggle';
import { getLang, t } from '@/lib/i18n';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [{ supabase, tenant, user }, lang] = await Promise.all([requireMerchant(), getLang()]);
  const { count: needsYou } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .eq('needs_human', true);

  const links = [
    ['/dashboard', t(lang, 'nav.products')],
    ['/dashboard/chats', t(lang, 'nav.chats')],
    ['/dashboard/orders', t(lang, 'nav.orders')],
    ['/dashboard/customers', t(lang, 'nav.customers')],
    ['/dashboard/analytics', t(lang, 'nav.analytics')],
    ['/dashboard/staff', t(lang, 'nav.team')],
    ['/dashboard/onboarding', t(lang, 'nav.profile')],
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <span className="flex min-w-0 items-center gap-2">
            {tenant.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tenant.logo_url} alt="" className="h-8 w-8 shrink-0 rounded-full border border-zinc-200 object-cover" />
            )}
            <span className="truncate text-lg font-semibold">{tenant.name}</span>
          </span>
          <form action={signOut} className="flex shrink-0 items-center gap-2 text-sm text-zinc-500">
            <LanguageToggle lang={lang} />
            <span className="hidden md:inline">{user.email}</span>
            <button className={btnGhost}>{t(lang, 'nav.signOut')}</button>
          </form>
        </div>

        {/* Scrolls sideways on a phone instead of wrapping into three rows or hiding behind a menu button. */}
        <nav className="mx-auto flex max-w-6xl gap-4 overflow-x-auto px-4 pb-2 text-sm text-zinc-600 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className="whitespace-nowrap py-1 hover:text-zinc-900">
              {label}
              {href === '/dashboard/chats' && !!needsYou && (
                <span className="ml-1 rounded-full bg-amber-500 px-1.5 py-0.5 text-[11px] font-semibold text-white">{needsYou}</span>
              )}
            </Link>
          ))}
          <Link href={`/chat/${tenant.slug}`} target="_blank" className="whitespace-nowrap py-1 font-medium text-zinc-900 hover:underline">
            {t(lang, 'nav.openChat')} ↗
          </Link>
        </nav>
      </header>

      {tenant.status === 'suspended' && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-700">{t(lang, 'suspended')}</div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">{children}</main>
      <LiveRefresh tenantId={tenant.id} />
    </div>
  );
}

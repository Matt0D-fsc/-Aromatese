'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnalyticsIcon, ChatIcon, HomeIcon, OrdersIcon, PeopleIcon, ProductsIcon } from '@/components/icons';

// A merchant uses this one-handed, on a phone, between customers. Bottom tabs put the five places they
// actually go within reach of a thumb; the same list becomes a row of links on a laptop.

const ICONS = { home: HomeIcon, chats: ChatIcon, orders: OrdersIcon, products: ProductsIcon, customers: PeopleIcon, analytics: AnalyticsIcon };

export type NavLink = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };

// /dashboard/products must not light up while you are on /dashboard, so the root is matched exactly.
const isCurrent = (pathname: string, href: string) => (href === '/dashboard' ? pathname === href : pathname.startsWith(href));

export function TopNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();

  return (
    <nav className="mx-auto hidden max-w-6xl gap-1 px-4 pb-2 text-sm sm:flex" aria-label="Main">
      {links.map((link) => {
        const current = isCurrent(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? 'page' : undefined}
            className={`rounded-chip px-3 py-1.5 font-medium transition-colors duration-150 ${
              current ? 'bg-content2 text-foreground' : 'text-zinc-500 hover:text-foreground'
            }`}
          >
            {link.label}
            {!!link.badge && (
              <span className="ml-1.5 rounded-full bg-warning px-1.5 py-0.5 text-[11px] font-semibold text-white">{link.badge}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomTabs({ links }: { links: NavLink[] }) {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden"
      aria-label="Main"
    >
      {links.map((link) => {
        const current = isCurrent(pathname, link.href);
        const Icon = ICONS[link.icon];
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? 'page' : undefined}
            className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 ${current ? 'text-accent' : 'text-zinc-500'}`}
          >
            <Icon size={21} />
            <span className={`text-[11px] ${current ? 'font-semibold' : 'font-medium'}`}>{link.label}</span>
            {!!link.badge && (
              <span className="absolute left-1/2 top-1.5 ml-2 flex min-w-[17px] items-center justify-center rounded-full bg-warning px-1 text-[10px] font-bold text-white">
                {link.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

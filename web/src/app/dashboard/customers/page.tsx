import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { getLang } from '@/lib/i18n-server';
import { btnGhost, card, input } from '@/components/ui';
import { dhakaTime, searchTerm } from '@/lib/chat';

// Everyone the AI has talked to. Their names and numbers were already being collected on every order; until
// now a merchant could only read them one order at a time.

type CustomerRow = {
  id: string;
  name: string | null;
  phone: string | null;
  channel: string;
  created_at: string;
  orders: { count: number }[];
  conversations: { id: string }[];
};

const PAGE_SIZE = 25;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; p?: string }> }) {
  const [{ supabase, tenant }, lang] = await Promise.all([requireMerchant(), getLang()]);
  if (!tenant.onboarding_completed_at) redirect('/dashboard/onboarding');

  const { q, p } = await searchParams;
  const search = searchTerm(q);
  const page = Math.max(1, Number(p) || 1);
  const from = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from('customers')
    .select('id, name, phone, channel, created_at, orders(count), conversations(id)', { count: 'exact' })
    .eq('tenant_id', tenant.id);
  if (search) query = query.or(`name.ilike.*${search}*,phone.ilike.*${search}*`);

  const { data, count } = await query.order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
  const customers = (data ?? []) as unknown as CustomerRow[];
  const total = count ?? 0;

  const href = (next: { q?: string; p?: number }) => {
    const params = new URLSearchParams();
    if (next.q ?? search) params.set('q', next.q ?? search);
    if ((next.p ?? 1) > 1) params.set('p', String(next.p));
    const qs = params.toString();
    return `/dashboard/customers${qs ? `?${qs}` : ''}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t(lang, 'customers.title')}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Everyone who has chatted with your shop. Names and numbers come from the orders the AI took.
          </p>
        </div>
        <form className="flex gap-2">
          <input name="q" defaultValue={search} className={`${input} w-56`} placeholder="Name or phone" aria-label="Search customers" maxLength={60} />
          <button className={btnGhost}>Search</button>
        </form>
      </div>

      {customers.length === 0 ? (
        <div className={`${card} py-16 text-center`}>
          <p className="text-lg font-medium">{search ? 'Nothing matches' : 'No customers yet'}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">
            {search ? 'Try a different name or number.' : 'Anyone who opens your chat link and talks to the AI appears here.'}
          </p>
        </div>
      ) : (
        <>
          {/* Cards on a phone, a table from sm up: a merchant checking a number on the bus should not scroll sideways. */}
          <ul className="space-y-3 sm:hidden">
            {customers.map((c) => (
              <li key={c.id} className={`${card} space-y-1 p-4 text-sm`}>
                <p className="font-medium">{c.name || 'Not given yet'}</p>
                {c.phone ? (
                  <a href={`tel:${c.phone}`} className="underline">
                    {c.phone}
                  </a>
                ) : (
                  <p className="text-zinc-400">No number yet</p>
                )}
                <p className="text-xs text-zinc-500">
                  {c.channel} · {c.orders[0]?.count ?? 0} orders · first seen {dhakaTime(c.created_at)}
                </p>
                {c.conversations[0]?.id && (
                  <Link href={`/dashboard/chats?c=${c.conversations[0].id}`} className="inline-block text-xs font-medium underline">
                    Open chat
                  </Link>
                )}
              </li>
            ))}
          </ul>

          <div className={`${card} hidden overflow-x-auto p-0 sm:block`}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-6 py-3">Name</th>
                  <th className="px-3 py-3">Phone</th>
                  <th className="px-3 py-3">Channel</th>
                  <th className="px-3 py-3">Orders</th>
                  <th className="px-3 py-3">First seen</th>
                  <th className="px-6 py-3 text-right">Chat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td className="px-6 py-3 font-medium">{c.name || <span className="font-normal text-zinc-400">Not given yet</span>}</td>
                    <td className="px-3 py-3">
                      {c.phone ? (
                        <a href={`tel:${c.phone}`} className="underline">
                          {c.phone}
                        </a>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-zinc-500">{c.channel}</td>
                    <td className="px-3 py-3 tabular-nums">{c.orders[0]?.count ?? 0}</td>
                    <td className="px-3 py-3 text-zinc-500">{dhakaTime(c.created_at)}</td>
                    <td className="px-6 py-3 text-right">
                      {c.conversations[0]?.id ? (
                        <Link href={`/dashboard/chats?c=${c.conversations[0].id}`} className="text-xs font-medium underline">
                          Open
                        </Link>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500">
            {from + 1}–{Math.min(from + PAGE_SIZE, total)} of {total.toLocaleString()}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={href({ p: page - 1 })} className={btnGhost}>
                ← Newer
              </Link>
            )}
            {from + PAGE_SIZE < total && (
              <Link href={href({ p: page + 1 })} className={btnGhost}>
                Older →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

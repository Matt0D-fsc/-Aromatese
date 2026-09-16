import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { signOut } from '@/app/login/actions';
import { taka } from '@/lib/chat';
import { btnDanger, btnGhost, card, input, statusBadge } from '@/components/ui';
import { LiveRefresh } from '@/components/live-refresh';
import { getAiSettings } from '@/lib/ai-settings';
import { GEMINI_MODEL } from '@/lib/gemini';
import { AiEngineForm } from './ai-engine-form';
import { InviteForm } from './invite-form';
import { setTenantStatus, updateMessageLimit } from './actions';

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  contact_email: string | null;
  monthly_message_limit: number;
  onboarding_completed_at: string | null;
  created_at: string;
  products: { count: number }[];
};

// One row per shop from the tenant_usage_month view (calendar month, UTC).
type UsageRow = { tenant_id: string; messages: number; conversations: number; orders: number; order_value: number; tokens: number };

export default async function AdminPage() {
  const { supabase, user } = await requireAdmin();

  const [{ data }, { data: usageData }] = await Promise.all([
    supabase
      .from('tenants')
      .select('id, name, slug, status, contact_email, monthly_message_limit, onboarding_completed_at, created_at, products(count)')
      .order('created_at', { ascending: false }),
    supabase.from('tenant_usage_month').select('*'),
  ]);
  const tenants = (data ?? []) as TenantRow[];
  // Server-only read (requireAdmin above). Only whether a key exists is passed to the browser, never the key.
  const ai = await getAiSettings();
  const usage = new Map(((usageData ?? []) as UsageRow[]).map((u) => [u.tenant_id, u]));

  const totals = [...usage.values()].reduce(
    (t, u) => ({ messages: t.messages + u.messages, orders: t.orders + u.orders, value: t.value + Number(u.order_value), tokens: t.tokens + u.tokens }),
    { messages: 0, orders: 0, value: 0, tokens: 0 },
  );

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <span className="text-lg font-semibold">ChatNab</span>
            <span className="ml-2 rounded bg-zinc-900 px-1.5 py-0.5 text-xs font-medium text-white">Admin</span>
          </div>
          <form action={signOut} className="flex items-center gap-3 text-sm text-zinc-500">
            {user.email}
            <button className={btnGhost}>Sign out</button>
          </form>
        </div>
      </header>

      <LiveRefresh />
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            ['Merchants', tenants.length.toLocaleString()],
            ['Messages this month', totals.messages.toLocaleString()],
            ['Orders this month', `${totals.orders.toLocaleString()} · ${taka(totals.value)}`],
            ['AI tokens this month', totals.tokens.toLocaleString()],
          ].map(([name, value]) => (
            <div key={name} className={card}>
              <p className="text-xs uppercase tracking-wide text-zinc-500">{name}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </section>

        <section className={card}>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">AI engine</h2>
            <p className="text-sm text-zinc-500">
              Powers every shop&apos;s chat agent and AI fill. Now using:{' '}
              <span className="font-medium text-zinc-900">{ai.provider === 'custom' ? `In-house · ${ai.model}` : `Gemini · ${GEMINI_MODEL}`}</span>
            </p>
          </div>
          <AiEngineForm provider={ai.provider} apiFormat={ai.apiFormat} baseUrl={ai.baseUrl ?? ''} model={ai.model ?? ''} hasKey={!!ai.apiKey} geminiModel={GEMINI_MODEL} />
        </section>

        <section className={card}>
          <h2 className="mb-4 text-base font-semibold">Invite a merchant</h2>
          <InviteForm />
        </section>

        <section className={`${card} overflow-x-auto p-0`}>
          <table className="w-full min-w-[64rem] text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-6 py-3">Merchant</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Products</th>
                <th className="px-3 py-3">Messages / limit</th>
                <th className="px-3 py-3">Chats</th>
                <th className="px-3 py-3">Orders</th>
                <th className="px-3 py-3">AI tokens</th>
                <th className="px-3 py-3">Monthly limit</th>
                <th className="px-6 py-3 text-right">Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {tenants.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-6 py-10 text-center text-zinc-500">No merchants yet. Invite your first one above.</td>
                </tr>
              )}
              {tenants.map((t) => {
                const u = usage.get(t.id);
                const used = u?.messages ?? 0;
                const overLimit = used >= t.monthly_message_limit;
                return (
                  <tr key={t.id}>
                    <td className="px-6 py-4">
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-zinc-500">{t.contact_email}</div>
                      {!t.onboarding_completed_at ? (
                        <div className="text-xs text-amber-600">Setup not finished</div>
                      ) : (
                        <Link href={`/chat/${t.slug}`} target="_blank" className="text-xs underline">Open chat ↗</Link>
                      )}
                    </td>
                    <td className="px-3 py-4"><span className={statusBadge(t.status)}>{t.status}</span></td>
                    <td className="px-3 py-4 tabular-nums">{t.products[0]?.count ?? 0}</td>
                    <td className={`px-3 py-4 tabular-nums ${overLimit ? 'font-semibold text-red-600' : ''}`}>
                      {used.toLocaleString()}
                      <span className="text-zinc-400"> / {t.monthly_message_limit.toLocaleString()}</span>
                    </td>
                    <td className="px-3 py-4 tabular-nums">{(u?.conversations ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-4 tabular-nums">
                      {(u?.orders ?? 0).toLocaleString()}
                      <div className="text-xs text-zinc-500">{taka(Number(u?.order_value ?? 0))}</div>
                    </td>
                    <td className="px-3 py-4 tabular-nums">{(u?.tokens ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-4">
                      <form action={updateMessageLimit.bind(null, t.id)} className="flex gap-2">
                        <input
                          className={`${input} w-24 py-1`}
                          name="limit"
                          type="number"
                          min={0}
                          step={1}
                          defaultValue={t.monthly_message_limit}
                          aria-label={`Monthly message limit for ${t.name}`}
                        />
                        <button className={`${btnGhost} px-2 py-1`}>Save</button>
                      </form>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {t.status === 'suspended' ? (
                        <form action={setTenantStatus.bind(null, t.id, 'active')}>
                          <button className={btnGhost}>Reactivate</button>
                        </form>
                      ) : (
                        <form action={setTenantStatus.bind(null, t.id, 'suspended')}>
                          <button className={btnDanger}>Suspend</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}

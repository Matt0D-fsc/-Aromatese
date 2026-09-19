import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { dhakaTime, taka } from '@/lib/chat';
import { btnDanger, btnGhost, card, input, statusBadge } from '@/components/ui';
import { getAiSettings } from '@/lib/ai-settings';
import { GEMINI_MODEL } from '@/lib/gemini';
import { AiEngineForm } from './ai-engine-form';
import { InviteForm } from './invite-form';
import { RetentionForm } from './retention-form';
import { setAiEnabled, setTenantStatus, setTokenRate, updateMessageLimit } from './actions';

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  contact_email: string | null;
  monthly_message_limit: number;
  ai_enabled: boolean;
  plan: string;
  plan_price_bdt: number;
  onboarding_completed_at: string | null;
  created_at: string;
  products: { count: number }[];
};

// Who did what, and what broke. Written by lib/audit.ts, never by the actor's own client.
type AuditRow = { id: string; event_type: string; tenant_id: string | null; actor_id: string | null; detail: Record<string, unknown> | null; created_at: string };

const AUDIT_FEED_SIZE = 25;

// One row per shop from the tenant_usage_month view (calendar month, UTC).
type UsageRow = { tenant_id: string; messages: number; conversations: number; orders: number; order_value: number; tokens: number };

export default async function AdminPage() {
  const { supabase } = await requireAdmin();

  const [{ data }, { data: usageData }, { data: auditData }] = await Promise.all([
    supabase
      .from('tenants')
      .select('id, name, slug, status, contact_email, monthly_message_limit, ai_enabled, plan, plan_price_bdt, onboarding_completed_at, created_at, products(count)')
      .order('created_at', { ascending: false }),
    supabase.from('tenant_usage_month').select('*'),
    supabase.from('audit_logs').select('id, event_type, tenant_id, actor_id, detail, created_at').order('created_at', { ascending: false }).limit(AUDIT_FEED_SIZE),
  ]);
  const tenants = (data ?? []) as TenantRow[];
  const activity = (auditData ?? []) as AuditRow[];

  // audit_logs.actor_id points at auth.users, which PostgREST cannot join to profiles, so the names are
  // looked up in one extra query and matched here.
  const actorIds = [...new Set(activity.map((a) => a.actor_id).filter((id): id is string => Boolean(id)))];
  const { data: actorRows } = actorIds.length ? await supabase.from('profiles').select('id, email').in('id', actorIds) : { data: [] };
  const actorEmail = new Map(((actorRows ?? []) as { id: string; email: string | null }[]).map((p) => [p.id, p.email]));
  const shopName = new Map(tenants.map((t) => [t.id, t.name]));
  // Server-only read (requireAdmin above). Only whether a key exists is passed to the browser, never the key.
  const ai = await getAiSettings();
  const usage = new Map(((usageData ?? []) as UsageRow[]).map((u) => [u.tenant_id, u]));

  const subscriptions = tenants.reduce((sum, t) => sum + Number(t.plan_price_bdt), 0);

  const totals = [...usage.values()].reduce(
    (t, u) => ({ messages: t.messages + u.messages, orders: t.orders + u.orders, value: t.value + Number(u.order_value), tokens: t.tokens + u.tokens }),
    { messages: 0, orders: 0, value: 0, tokens: 0 },
  );
  const aiCost = (totals.tokens / 1_000_000) * ai.takaPerMillionTokens;

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            ['Merchants', tenants.length.toLocaleString()],
            ['Messages this month', totals.messages.toLocaleString()],
            ['Orders this month', `${totals.orders.toLocaleString()} · ${taka(totals.value)}`],
            ['AI tokens this month', ai.takaPerMillionTokens > 0 ? `${totals.tokens.toLocaleString()} · ${taka(aiCost)}` : totals.tokens.toLocaleString()],
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
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Billing</h2>
            <p className="text-sm text-zinc-500">
              Charging <span className="font-medium text-zinc-900">{taka(subscriptions)}</span> a month
              {ai.takaPerMillionTokens > 0 && (
                <>
                  {' '}
                  · AI costing <span className="font-medium text-zinc-900">{taka(aiCost)}</span> · margin{' '}
                  <span className="font-medium text-zinc-900">{taka(subscriptions - aiCost)}</span>
                </>
              )}
            </p>
          </div>
          {/* Each shop's plan and price are set on its own page; this is the rate that turns tokens into taka. */}
          <form action={setTokenRate} className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700" htmlFor="rate">
                Taka per million AI tokens
              </label>
              <input className={`${input} w-40`} id="rate" name="rate" type="number" min={0} step="0.01" defaultValue={ai.takaPerMillionTokens} />
            </div>
            <button className={btnGhost}>Save rate</button>
          </form>
        </section>

        <section className={card}>
          <h2 className="mb-4 text-base font-semibold">Invite a merchant</h2>
          <InviteForm />
        </section>

        <section className={`${card} overflow-x-auto p-0`}>
          <table className="w-full min-w-[68rem] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-6 py-3">Merchant</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Products</th>
                <th className="px-3 py-3">Messages / limit</th>
                <th className="px-3 py-3">Chats</th>
                <th className="px-3 py-3">Orders</th>
                <th className="px-3 py-3">AI tokens</th>
                <th className="px-3 py-3">Monthly limit</th>
                <th className="px-3 py-3">AI</th>
                <th className="px-6 py-3 text-right">Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tenants.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-6 py-10 text-center text-zinc-500">No merchants yet. Invite your first one above.</td>
                </tr>
              )}
              {tenants.map((t) => {
                const u = usage.get(t.id);
                const used = u?.messages ?? 0;
                const overLimit = used >= t.monthly_message_limit;
                return (
                  <tr key={t.id}>
                    <td className="px-6 py-4">
                      <Link href={`/admin/tenants/${t.id}`} className="font-medium hover:underline">{t.name}</Link>
                      <div className="text-xs text-zinc-500">{t.contact_email}</div>
                      {!t.onboarding_completed_at ? (
                        <div className="text-xs text-warning">Setup not finished</div>
                      ) : (
                        <Link href={`/chat/${t.slug}`} target="_blank" className="text-xs underline">Open chat ↗</Link>
                      )}
                    </td>
                    <td className="px-3 py-4">
                      <span className={statusBadge(t.status)}>{t.status}</span>
                      <div className="mt-1 text-xs text-zinc-500">
                        {t.plan}
                        {Number(t.plan_price_bdt) > 0 && ` · ${taka(Number(t.plan_price_bdt))}`}
                      </div>
                    </td>
                    <td className="px-3 py-4 tabular-nums">{t.products[0]?.count ?? 0}</td>
                    <td className={`px-3 py-4 tabular-nums ${overLimit ? 'font-semibold text-danger' : ''}`}>
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
                    {/* Pausing the AI leaves the shop working: customers still reach the inbox, staff still reply. */}
                    <td className="px-3 py-4">
                      <form action={setAiEnabled.bind(null, t.id, !t.ai_enabled)}>
                        <button className={`${btnGhost} px-2 py-1 text-xs`} title={t.ai_enabled ? 'Stop the AI replying for this shop' : 'Let the AI reply again'}>
                          {t.ai_enabled ? 'On · pause' : 'Paused · resume'}
                        </button>
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

        <section className={card}>
          <h2 className="mb-1 text-base font-semibold">Recent activity</h2>
          <p className="mb-4 text-sm text-zinc-500">
            Every change made in the dashboards, and every failure. Rows are written by the server, so nobody can edit their own trail.
          </p>
          {activity.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {activity.map((a) => {
                const failed = a.event_type.startsWith('error.');
                return (
                  <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
                    <span className="flex flex-wrap items-baseline gap-2">
                      <code className={`rounded-chip px-1.5 py-0.5 text-xs ${failed ? 'bg-danger-soft text-danger-strong' : 'bg-zinc-100 text-zinc-700'}`}>{a.event_type}</code>
                      {a.tenant_id && <span className="text-zinc-600">{shopName.get(a.tenant_id) ?? 'deleted shop'}</span>}
                      {a.actor_id && <span className="text-zinc-500">{actorEmail.get(a.actor_id) ?? 'unknown user'}</span>}
                      {a.detail?.message != null && <span className="text-danger">{String(a.detail.message).slice(0, 160)}</span>}
                    </span>
                    <span className="text-xs text-zinc-400">{dhakaTime(a.created_at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={card}>
          <h2 className="mb-1 text-base font-semibold">Data retention</h2>
          <p className="mb-4 text-sm text-zinc-500">Old conversations cost storage and hold customers&apos; personal details longer than any shop needs.</p>
          <RetentionForm />
        </section>
    </main>
  );
}

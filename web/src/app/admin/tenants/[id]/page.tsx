import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { MicIcon, PhotoIcon } from '@/components/icons';
import { btnGhost, card, hint, input, label, statusBadge } from '@/components/ui';
import { dhakaTime, mediaLabel, taka, toChatLine, MESSAGE_COLUMNS, type MessageRow } from '@/lib/chat';
import { POLICY_FIELDS, readPolicies } from '@/lib/policies';
import { getAiSettings } from '@/lib/ai-settings';
import { saveAiPersona, updatePlan } from '../../actions';
import { readPersona, readPlaybook } from '@/lib/ai-profile';
import { PLANS } from '@/lib/plans';

// One shop, read-only, for when a merchant says "the AI told my customer something wrong". The platform admin
// can look without signing in as them and without being able to reply in their name.

type Tenant = {
  id: string; name: string; slug: string; status: string; contact_email: string | null; contact_phone: string | null;
  business_category: string | null; address: string | null; monthly_message_limit: number; ai_enabled: boolean;
  onboarding_completed_at: string | null; created_at: string; policies: unknown; plan: string; plan_price_bdt: number;
  ai_persona: unknown; ai_playbook: unknown;
};
type OrderRow = { id: string; order_number: string; status: string; total_bdt: number; created_at: string; shipping_address: { name?: string; phone?: string } };
type ConversationRow = { id: string; channel: string; last_message_at: string; needs_human: boolean; ai_muted: boolean; customers: { name: string | null; phone: string | null } | null };
type AuditRow = { id: string; event_type: string; detail: Record<string, unknown> | null; created_at: string };

export default async function AdminTenantPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ c?: string }> }) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  const { c } = await searchParams;

  const { data: tenantRow } = await supabase.from('tenants').select('*').eq('id', id).maybeSingle();
  if (!tenantRow) notFound();
  const tenant = tenantRow as Tenant;
  const policies = readPolicies(tenant.policies);
  const persona = readPersona(tenant.ai_persona);
  const playbook = readPlaybook(tenant.ai_playbook);

  const [{ data: usage }, { data: orderRows }, { data: conversationRows }, { data: auditRows }, { count: products }] = await Promise.all([
    supabase.from('tenant_usage_month').select('*').eq('tenant_id', id).maybeSingle(),
    supabase.from('orders').select('id, order_number, status, total_bdt, created_at, shipping_address').eq('tenant_id', id).order('created_at', { ascending: false }).limit(10),
    supabase
      .from('conversations')
      .select('id, channel, last_message_at, needs_human, ai_muted, customers(name, phone)')
      .eq('tenant_id', id)
      .order('last_message_at', { ascending: false })
      .limit(10),
    supabase.from('audit_logs').select('id, event_type, detail, created_at').eq('tenant_id', id).order('created_at', { ascending: false }).limit(10),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('tenant_id', id),
  ]);

  const orders = (orderRows ?? []) as OrderRow[];
  const conversations = (conversationRows ?? []) as unknown as ConversationRow[];
  const activity = (auditRows ?? []) as AuditRow[];
  const openChat = conversations.find((x) => x.id === c);

  const { data: messageRows } = openChat
    ? await supabase.from('messages').select(MESSAGE_COLUMNS).eq('conversation_id', openChat.id).order('created_at', { ascending: false }).limit(50)
    : { data: [] };
  const messages = ((messageRows ?? []) as MessageRow[]).slice().reverse();

  // What this shop costs to serve, from their own token usage and the platform-wide rate.
  const rate = Number((await getAiSettings()).takaPerMillionTokens ?? 0);
  const aiCost = (Number(usage?.tokens ?? 0) / 1_000_000) * rate;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin" className="text-sm text-zinc-500 hover:underline">
            ← All merchants
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold">
            {tenant.name} <span className={statusBadge(tenant.status)}>{tenant.status}</span>
            {!tenant.ai_enabled && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-strong ring-1 ring-inset ring-warning/30">AI paused</span>}
          </h1>
        </div>
        <Link href={`/chat/${tenant.slug}`} target="_blank" className={btnGhost}>
          Open their chat ↗
        </Link>
      </div>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ['Products', (products ?? 0).toLocaleString()],
          ['Messages this month', `${(usage?.messages ?? 0).toLocaleString()} / ${tenant.monthly_message_limit.toLocaleString()}`],
          ['Orders this month', `${(usage?.orders ?? 0).toLocaleString()} · ${taka(Number(usage?.order_value ?? 0))}`],
          ['AI tokens this month', (usage?.tokens ?? 0).toLocaleString()],
        ].map(([name, value]) => (
          <div key={name} className={card}>
            <p className="text-xs uppercase tracking-wide text-zinc-500">{name}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </section>

      <section className={card}>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Plan and billing</h2>
          <p className="text-sm text-zinc-500">
            {rate > 0 ? (
              <>
                AI cost this month <span className="font-medium text-zinc-900">{taka(aiCost)}</span> against{' '}
                <span className="font-medium text-zinc-900">{taka(Number(tenant.plan_price_bdt))}</span> charged
                {tenant.plan_price_bdt > 0 && <> · margin {taka(Number(tenant.plan_price_bdt) - aiCost)}</>}
              </>
            ) : (
              <>Set a taka rate per million tokens in the admin panel to see what this shop costs to serve.</>
            )}
          </p>
        </div>
        <form action={updatePlan.bind(null, tenant.id)} className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700" htmlFor="plan">
              Plan
            </label>
            <select className={`${input} w-40`} id="plan" name="plan" defaultValue={tenant.plan}>
              {PLANS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700" htmlFor="price">
              Monthly price (BDT)
            </label>
            <input className={`${input} w-40`} id="price" name="price" type="number" min={0} step={1} defaultValue={Number(tenant.plan_price_bdt)} />
          </div>
          <button className={btnGhost}>Save plan</button>
        </form>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className="mb-3 text-base font-semibold">Shop profile</h2>
          <dl className="space-y-1 text-sm">
            {[
              ['Contact', tenant.contact_email],
              ['Phone', tenant.contact_phone],
              ['Sells', tenant.business_category],
              ['Address', tenant.address],
              ['Chat link', `/chat/${tenant.slug}`],
              ['Joined', dhakaTime(tenant.created_at)],
              ['Finished setup', tenant.onboarding_completed_at ? dhakaTime(tenant.onboarding_completed_at) : 'Not yet'],
            ].map(([label, value]) => (
              <div key={label} className="flex gap-3">
                <dt className="w-32 shrink-0 text-zinc-500">{label}</dt>
                <dd className="break-words">{value || <span className="text-zinc-400">—</span>}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className={card}>
          <h2 className="mb-3 text-base font-semibold">What their AI may promise</h2>
          {Object.keys(policies).length === 0 ? (
            <p className="py-4 text-sm text-zinc-500">
              No policies set, so their AI answers every delivery, payment and returns question with &ldquo;the shop will confirm&rdquo;.
            </p>
          ) : (
            <dl className="space-y-1 text-sm">
              {POLICY_FIELDS.filter((f) => policies[f.key]).map((f) => (
                <div key={f.key} className="flex gap-3">
                  <dt className="w-44 shrink-0 text-zinc-500">{f.label}</dt>
                  <dd className="break-words">{policies[f.key]}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className="mb-1 text-base font-semibold">AI persona</h2>
          <p className="mb-4 text-sm text-zinc-500">Only you can see and change this. Platform instructions override the shop&apos;s own instructions.</p>
          <form action={saveAiPersona.bind(null, tenant.id)} className="space-y-4">
            <div>
              <label className={label} htmlFor="assistantName">Assistant name</label>
              <input className={input} id="assistantName" name="assistantName" maxLength={60} defaultValue={persona.assistantName ?? ''} placeholder="e.g. Rupa" />
              <p className={hint}>Blank: it introduces itself as the shop&apos;s AI assistant.</p>
            </div>
            <div>
              <label className={label} htmlFor="tone">Persona and tone</label>
              <textarea className={input} id="tone" name="tone" rows={3} maxLength={1000} defaultValue={persona.tone ?? ''} placeholder="Warm older-sister tone, calls customers apu/bhaiya, light emoji" />
            </div>
            <div>
              <label className={label} htmlFor="adminInstructions">Platform instructions</label>
              <textarea className={input} id="adminInstructions" name="adminInstructions" rows={4} maxLength={3000} defaultValue={persona.adminInstructions ?? ''} placeholder="Never promise same-day delivery. Always hand off orders above 10,000 taka." />
            </div>
            <button className={btnGhost}>Save persona</button>
          </form>
        </section>

        <section className={card}>
          <h2 className="mb-1 text-base font-semibold">Shop&apos;s AI instructions</h2>
          <p className="mb-4 text-sm text-zinc-500">Written by the merchant under AI instructions in their dashboard.</p>
          {playbook.length === 0 ? (
            <p className="py-4 text-sm text-zinc-500">None yet.</p>
          ) : (
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              {playbook.map((r, i) => (
                <li key={i}>
                  <span className="text-zinc-500">When</span> {r.when} <span className="text-zinc-500">→</span> {r.then}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className={card}>
        <h2 className="mb-3 text-base font-semibold">Recent chats</h2>
        {conversations.length === 0 ? (
          <p className="py-4 text-sm text-zinc-500">No chats yet.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {conversations.map((conv) => (
              <li key={conv.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="flex flex-wrap items-baseline gap-2">
                  <Link href={`/admin/tenants/${id}?c=${conv.id}`} className="font-medium hover:underline">
                    {conv.customers?.name || conv.customers?.phone || `Visitor ${conv.id.slice(0, 6)}`}
                  </Link>
                  <span className="text-xs text-zinc-500">{conv.channel}</span>
                  {conv.needs_human && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning-strong">Needs them</span>}
                  {conv.ai_muted && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-strong">Staff</span>}
                </span>
                <span className="text-xs text-zinc-400">{dhakaTime(conv.last_message_at)}</span>
              </li>
            ))}
          </ul>
        )}

        {openChat && (
          <div className="mt-4 space-y-2 border-t border-zinc-100 pt-4">
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Reading {openChat.customers?.name || `visitor ${openChat.id.slice(0, 6)}`} · view only
            </p>
            <div className="max-h-96 space-y-2 overflow-y-auto">
              {messages.map((m) => {
                const line = toChatLine(m);
                const fromCustomer = line.from === 'customer';
                return (
                  <div key={line.id} className={`flex ${fromCustomer ? 'justify-start' : 'justify-end'}`}>
                    <div
                      className={`max-w-[85%] rounded-card px-3 py-2 text-sm ${
                        fromCustomer ? 'bg-zinc-100' : line.from === 'agent' ? 'bg-accent text-accent-foreground' : 'bg-foreground text-background'
                      }`}
                    >
                      {!fromCustomer && <p className="text-[10px] font-semibold uppercase opacity-70">{line.from === 'agent' ? 'Team' : 'AI'}</p>}
                      {line.kind !== 'text' && (
                        <p className="flex items-center gap-1.5 opacity-70">
                          {line.kind === 'audio' ? <MicIcon size={14} /> : <PhotoIcon size={14} />}
                          {mediaLabel(line.kind)}
                        </p>
                      )}
                      {line.mediaNote && <p className="text-xs italic opacity-70">{line.mediaNote}</p>}
                      {line.text && <p className="whitespace-pre-wrap">{line.text}</p>}
                      <p className="mt-1 text-[10px] opacity-60">{dhakaTime(m.created_at)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className="mb-3 text-base font-semibold">Recent orders</h2>
          {orders.length === 0 ? (
            <p className="py-4 text-sm text-zinc-500">No orders yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {orders.map((o) => (
                <li key={o.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{o.order_number}</span> <span className="text-zinc-500">{o.shipping_address?.name ?? ''}</span>
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="tabular-nums">{taka(o.total_bdt)}</span>
                    <span className="text-xs text-zinc-500">{o.status}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card}>
          <h2 className="mb-3 text-base font-semibold">Activity</h2>
          {activity.length === 0 ? (
            <p className="py-4 text-sm text-zinc-500">Nothing recorded for this shop yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {activity.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <code className={`rounded-chip px-1.5 py-0.5 text-xs ${a.event_type.startsWith('error.') ? 'bg-danger-soft text-danger-strong' : 'bg-zinc-100 text-zinc-700'}`}>
                    {a.event_type}
                  </code>
                  <span className="text-xs text-zinc-400">{dhakaTime(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

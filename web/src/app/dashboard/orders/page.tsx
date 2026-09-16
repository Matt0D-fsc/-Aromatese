import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { btn, btnDanger, card, statusBadge } from '@/components/ui';
import { dhakaTime, taka } from '@/lib/chat';
import { setOrderStatus } from './actions';

type OrderRow = {
  id: string;
  order_number: string;
  status: 'draft' | 'confirmed' | 'cancelled';
  total_bdt: number;
  payment_method: string;
  created_at: string;
  shipping_address: { name?: string; phone?: string; address?: string; note?: string };
  items: { title: string; quantity: number; unit_price: number }[];
};

const STATUS_LABEL = { draft: 'new', confirmed: 'active', cancelled: 'suspended' } as const;

export default async function OrdersPage() {
  const { supabase, tenant } = await requireMerchant();
  if (!tenant.onboarding_completed_at) redirect('/dashboard/onboarding');

  const { data } = await supabase
    .from('orders')
    .select('id, order_number, status, total_bdt, payment_method, created_at, shipping_address, items')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(100);
  const orders = (data ?? []) as OrderRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Orders</h1>
        <p className="mt-1 text-sm text-zinc-500">Orders your AI agent took in chat. Call the customer, then confirm. Confirming takes the items out of stock.</p>
      </div>

      {orders.length === 0 ? (
        <div className={`${card} py-16 text-center`}>
          <p className="text-lg font-medium">No orders yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">When a customer agrees to buy in chat, the AI collects their details and the order shows up here.</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {orders.map((o) => (
            <li key={o.id} className={`${card} space-y-3`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{o.order_number}</span>
                  {/* statusBadge colours: new = amber, confirmed = green, cancelled = red */}
                  <span className={statusBadge(STATUS_LABEL[o.status])}>{o.status === 'draft' ? 'new' : o.status}</span>
                </div>
                <span className="text-sm text-zinc-500">{dhakaTime(o.created_at)}</span>
              </div>

              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="font-medium">{o.shipping_address.name}</p>
                  <p>
                    <a href={`tel:${o.shipping_address.phone}`} className="underline">
                      {o.shipping_address.phone}
                    </a>
                  </p>
                  <p className="text-zinc-600">{o.shipping_address.address}</p>
                  {o.shipping_address.note && <p className="text-zinc-500">Note: {o.shipping_address.note}</p>}
                </div>
                <div>
                  <ul>
                    {o.items.map((item, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span>
                          {item.quantity} × {item.title}
                        </span>
                        <span className="tabular-nums">{taka(item.unit_price * item.quantity)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 flex justify-between border-t border-zinc-100 pt-1 font-semibold">
                    <span>Total ({o.payment_method.toUpperCase()}, excl. delivery)</span>
                    <span className="tabular-nums">{taka(o.total_bdt)}</span>
                  </p>
                </div>
              </div>

              {o.status === 'draft' && tenant.status !== 'suspended' && (
                <div className="flex gap-2">
                  <form action={setOrderStatus.bind(null, o.id, 'confirmed')}>
                    <button className={btn}>Confirm</button>
                  </form>
                  <form action={setOrderStatus.bind(null, o.id, 'cancelled')}>
                    <button className={btnDanger}>Cancel</button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

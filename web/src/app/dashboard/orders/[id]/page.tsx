import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { card } from '@/components/ui';
import { OrderEditor } from '../order-editor';
import { editorData } from '../editor-data';

type OrderItem = { product_id: string; variant?: string; quantity: number; unit_price: number };
type Shipping = { name?: string; phone?: string; address?: string; area?: '' | 'inside_dhaka' | 'outside_dhaka'; note?: string };

// Change a new order before it is confirmed: the price agreed on the phone, a corrected address, one more item.
// A confirmed order has taken its stock, so it is cancelled and made again instead.
export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, tenant } = await requireMerchant();
  const { id } = await params;

  const { data: order } = await supabase
    .from('orders')
    .select('id, order_number, status, items, shipping_address, courier_fee_bdt')
    .eq('id', id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!order) notFound();

  const back = `/dashboard/orders?q=${encodeURIComponent(order.order_number)}`;
  if (order.status !== 'draft') {
    return (
      <div className={`${card} mx-auto max-w-xl space-y-2`}>
        <h1 className="text-lg font-semibold">{order.order_number} can no longer be edited</h1>
        <p className="text-sm text-zinc-500">
          It is {order.status}. {order.status === 'confirmed' ? 'Cancel it (its stock comes back) and create a new order from the chat.' : ''}
        </p>
        <Link href={back} className="text-sm underline">
          Back to the order
        </Link>
      </div>
    );
  }

  const shipping = (order.shipping_address ?? {}) as Shipping;
  const { products, fees } = await editorData(supabase, tenant);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={back} className="text-sm text-zinc-500 hover:underline">
          ← Orders
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Edit {order.order_number}</h1>
      </div>
      <div className={card}>
        <OrderEditor
          products={products}
          fees={fees}
          initial={{
            orderId: order.id,
            lines: ((order.items ?? []) as OrderItem[]).map((i) => ({
              productId: i.product_id,
              variant: i.variant ?? '',
              quantity: String(i.quantity),
              unitPrice: String(i.unit_price),
            })),
            name: shipping.name ?? '',
            phone: shipping.phone ?? '',
            address: shipping.address ?? '',
            area: shipping.area ?? '',
            note: shipping.note ?? '',
            deliveryFee: String(Number(order.courier_fee_bdt ?? 0)),
          }}
        />
      </div>
    </div>
  );
}

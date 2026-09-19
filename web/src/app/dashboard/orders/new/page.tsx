import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { card } from '@/components/ui';
import { OrderEditor } from '../order-editor';
import { editorData } from '../editor-data';

// Staff write the order a customer agreed in chat: a bargained price, a discount a shop instruction allowed.
export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { supabase, tenant } = await requireMerchant();
  const { c } = await searchParams;
  if (!c) notFound();

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, customers(name, phone)')
    .eq('id', c)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!conversation) notFound();
  const customer = conversation.customers as unknown as { name: string | null; phone: string | null } | null;

  // The address from their last order, if they have one: most repeat customers live where they did last time.
  const { data: last } = await supabase
    .from('orders')
    .select('shipping_address')
    .eq('tenant_id', tenant.id)
    .eq('conversation_id', c)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastAddress = (last?.shipping_address ?? {}) as { address?: string; area?: '' | 'inside_dhaka' | 'outside_dhaka' };

  const { products, fees } = await editorData(supabase, tenant);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={`/dashboard/chats?c=${c}`} className="text-sm text-zinc-500 hover:underline">
          ← Back to the chat
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">New order</h1>
        <p className="mt-1 text-sm text-zinc-500">For what you agreed with this customer. They get the summary in their chat, and it waits in Orders for you to confirm like any other.</p>
      </div>
      <div className={card}>
        <OrderEditor
          products={products}
          fees={fees}
          initial={{
            conversationId: c,
            lines: [{ productId: '', variant: '', quantity: '1', unitPrice: '' }],
            name: customer?.name ?? '',
            phone: customer?.phone ?? '',
            address: lastAddress.address ?? '',
            area: lastAddress.area ?? '',
            note: '',
            deliveryFee: lastAddress.area && fees[lastAddress.area] !== null ? String(fees[lastAddress.area]) : '',
          }}
        />
      </div>
    </div>
  );
}

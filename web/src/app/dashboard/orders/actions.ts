'use server';

import { revalidatePath } from 'next/cache';
import { requireMerchant } from '@/lib/auth';
import { audit, throwAudited } from '@/lib/audit';

export async function setOrderStatus(orderId: string, status: 'confirmed' | 'cancelled') {
  const { supabase, tenant, user } = await requireMerchant();
  if (tenant.status === 'suspended') throw new Error('Your shop is suspended.');

  // confirm_order also takes the items out of stock, in one transaction, only for new orders. RLS scopes both to this shop.
  const { error } =
    status === 'confirmed'
      ? await supabase.rpc('confirm_order', { oid: orderId })
      : await supabase.from('orders').update({ status: 'cancelled' }).eq('id', orderId).eq('status', 'draft').eq('tenant_id', tenant.id);
  if (error) await throwAudited('order.status', error, { actorId: user.id, tenantId: tenant.id, detail: { orderId, status } });

  await audit(`order.${status}`, { actorId: user.id, tenantId: tenant.id, detail: { orderId } });
  revalidatePath('/dashboard/orders');
}

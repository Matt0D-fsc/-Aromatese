'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { audit, throwAudited } from '@/lib/audit';

export async function setOrderStatus(orderId: string, status: 'confirmed' | 'cancelled') {
  const { supabase, tenant, user } = await requireMerchant();
  if (tenant.status === 'suspended') throw new Error('Your shop is suspended.');

  // Both run in one transaction and are scoped to this shop by RLS. confirm_order takes the items out of stock and
  // refuses when there is not enough; cancel_order puts stock back if the order had been confirmed.
  const { error } = await supabase.rpc(status === 'confirmed' ? 'confirm_order' : 'cancel_order', { oid: orderId });

  // Short stock is the shop's reality, not a crash: say which item, on the orders page.
  if (error?.hint === 'out_of_stock') {
    await audit('order.confirm_refused', { actorId: user.id, tenantId: tenant.id, detail: { orderId, reason: error.message } });
    redirect(`/dashboard/orders?f=draft&stock=${encodeURIComponent(error.message)}`);
  }
  if (error) await throwAudited('order.status', error, { actorId: user.id, tenantId: tenant.id, detail: { orderId, status } });

  await audit(`order.${status}`, { actorId: user.id, tenantId: tenant.id, detail: { orderId } });
  revalidatePath('/dashboard', 'layout');
}

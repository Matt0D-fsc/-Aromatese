'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { audit, throwAudited } from '@/lib/audit';
import { BD_MOBILE, collectAmount, newOrderNumber, type DeliveryArea } from '@/lib/orders';

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

export type OrderLineInput = { productId: string; variant: string; quantity: string; unitPrice: string };
export type OrderInput = {
  orderId?: string;
  conversationId?: string;
  lines: OrderLineInput[];
  name: string;
  phone: string;
  address: string;
  area: '' | DeliveryArea;
  note: string;
  deliveryFee: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The other half of the AI's order flow: what staff agree with a customer (a bargained price, a discount a shop
// instruction allowed, a corrected address) goes into an order here. A new order comes from a chat, so it belongs
// to that customer and the customer sees the summary; a new (not yet confirmed) order can be edited.
// Prices are the staff's to set, so each line also keeps the catalog price it started from.
export async function saveOrder(input: OrderInput): Promise<{ error: string } | undefined> {
  const { supabase, tenant, user } = await requireMerchant();
  if (tenant.status === 'suspended') return { error: 'Your shop is suspended.' };

  const name = String(input.name ?? '').trim().slice(0, 100);
  const phone = String(input.phone ?? '').replace(/[\s-]/g, '');
  const address = String(input.address ?? '').trim().slice(0, 500);
  const note = String(input.note ?? '').trim().slice(0, 300);
  const area = input.area === 'inside_dhaka' || input.area === 'outside_dhaka' ? input.area : null;
  const deliveryFee = input.deliveryFee === '' ? 0 : Number(input.deliveryFee);
  if (!name) return { error: "Add the customer's name." };
  if (!BD_MOBILE.test(phone)) return { error: 'Enter a Bangladeshi mobile number like 01712345678.' };
  if (address.length < 10) return { error: 'Add the full delivery address (house/road, area, district).' };
  if (!Number.isFinite(deliveryFee) || deliveryFee < 0) return { error: 'The delivery charge must be 0 or more.' };

  const lines = (Array.isArray(input.lines) ? input.lines : []).filter((l) => l?.productId);
  if (lines.length < 1 || lines.length > 20) return { error: 'An order needs 1 to 20 items.' };
  for (const l of lines) {
    const qty = Number(l.quantity);
    const price = Number(l.unitPrice);
    if (!UUID.test(l.productId) || !Number.isInteger(qty) || qty < 1 || qty > 99) return { error: 'Each item needs a product and a quantity from 1 to 99.' };
    if (l.unitPrice === '' || !Number.isFinite(price) || price < 0) return { error: 'Each item needs a price of 0 or more.' };
  }

  // Titles, SKUs and catalog prices come from this shop's own rows; RLS keeps another shop's ids out.
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const [{ data: products }, { data: variants }] = await Promise.all([
    supabase.from('products').select('id, sku, title_en, price_bdt, discount_price_bdt').eq('tenant_id', tenant.id).in('id', productIds),
    supabase.from('variants').select('product_id, name, price_bdt').eq('tenant_id', tenant.id).in('product_id', productIds),
  ]);

  const items = [];
  for (const l of lines) {
    const p = products?.find((row) => row.id === l.productId);
    if (!p) return { error: 'One of the products no longer exists. Pick it again.' };
    const productVariants = (variants ?? []).filter((v) => v.product_id === p.id);
    const variant = l.variant ? productVariants.find((v) => v.name === l.variant) : null;
    if (productVariants.length && !variant) return { error: `Pick a size or colour for ${p.title_en}.` };
    items.push({
      product_id: p.id,
      sku: p.sku,
      title: variant ? `${p.title_en} (${variant.name})` : p.title_en,
      ...(variant && { variant: variant.name }),
      quantity: Number(l.quantity),
      unit_price: Number(l.unitPrice),
      list_price: Number(variant?.price_bdt ?? p.discount_price_bdt ?? p.price_bdt),
    });
  }
  const total = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
  const shipping = { name, phone, address, ...(area && { area }), ...(note && { note }) };

  if (input.orderId) {
    if (!UUID.test(input.orderId)) return { error: 'Invalid order.' };
    // Only a new order: a confirmed one has already taken its stock. Cancel it and make a new one instead.
    const { data: updated, error } = await supabase
      .from('orders')
      .update({ items, total_bdt: total, courier_fee_bdt: deliveryFee, shipping_address: shipping })
      .eq('id', input.orderId)
      .eq('tenant_id', tenant.id)
      .eq('status', 'draft')
      .select('order_number');
    if (error) return { error: error.message };
    if (!updated?.length) return { error: 'This order was confirmed or cancelled in the meantime, so it can no longer be edited.' };
    await audit('order.edited', { actorId: user.id, tenantId: tenant.id, detail: { orderId: input.orderId, total, deliveryFee } });
    revalidatePath('/dashboard', 'layout');
    redirect(`/dashboard/orders?q=${encodeURIComponent(updated[0].order_number)}`);
  }

  if (!input.conversationId || !UUID.test(input.conversationId)) return { error: "Open the customer's chat and create the order from there." };
  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, customer_id')
    .eq('id', input.conversationId)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!conversation) return { error: 'That chat no longer exists.' };

  const orderNumber = newOrderNumber();
  const { error } = await supabase.from('orders').insert({
    tenant_id: tenant.id,
    customer_id: conversation.customer_id,
    conversation_id: conversation.id,
    idempotency_key: `staff-${crypto.randomUUID()}`,
    order_number: orderNumber,
    status: 'draft',
    total_bdt: total,
    courier_fee_bdt: deliveryFee,
    payment_method: 'cod',
    shipping_address: shipping,
    items,
  });
  if (error) return { error: error.message };

  // The customer sees what was agreed, in their chat, from a person. Staff are handling this chat now.
  const bdt = (n: number) => `৳${n.toLocaleString('en-IN')}`;
  const summary = [
    `Order ${orderNumber}:`,
    ...items.map((i) => `${i.quantity} x ${i.title}: ${bdt(i.unit_price * i.quantity)}`),
    deliveryFee ? `Delivery: ${bdt(deliveryFee)}` : '',
    `Total to pay on delivery: ${bdt(collectAmount({ total_bdt: total, courier_fee_bdt: deliveryFee }))}`,
    'Amader team call kore confirm korbe.',
  ].filter(Boolean);
  const now = new Date().toISOString();
  const { error: messageError } = await supabase.from('messages').insert({
    tenant_id: tenant.id,
    conversation_id: conversation.id,
    sender_type: 'agent',
    content_type: 'text',
    content_text: summary.join('\n'),
    grounding_data: { orderNumber },
    sent_by: user.id,
  });
  if (messageError) await audit('error.order.summary_message', { actorId: user.id, tenantId: tenant.id, detail: { orderNumber, message: messageError.message } });
  await Promise.all([
    supabase.from('conversations').update({ ai_muted: true, needs_human: false, last_staff_reply_at: now, last_message_at: now }).eq('id', conversation.id),
    supabase.from('customers').update({ name, phone }).eq('id', conversation.customer_id),
  ]);

  await audit('order.created_by_staff', { actorId: user.id, tenantId: tenant.id, detail: { orderNumber, total, deliveryFee, conversationId: conversation.id } });
  revalidatePath('/dashboard', 'layout');
  redirect(`/dashboard/orders?q=${encodeURIComponent(orderNumber)}`);
}

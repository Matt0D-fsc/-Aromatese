'use client';

import { useState, useTransition } from 'react';
import { saveOrder, type OrderInput, type OrderLineInput } from './actions';
import type { DeliveryArea } from '@/lib/orders';
import { btn, btnDanger, btnGhost, errorBox, hint, input, label } from '@/components/ui';
import { taka } from '@/lib/chat';

export type EditorProduct = { id: string; title: string; price: number; stock: number; variants: { name: string; price: number; stock: number }[] };

const AREA_LABEL: Record<DeliveryArea, string> = { inside_dhaka: 'Inside Dhaka', outside_dhaka: 'Outside Dhaka' };

// Staff write the order they agreed: any product from the shop, any price (a bargain, an allowed discount), the
// delivery charge from the shop's policies or typed in. The catalog price stays visible next to a changed one.
export function OrderEditor({
  products,
  fees,
  initial,
}: {
  products: EditorProduct[];
  fees: Record<DeliveryArea, number | null>;
  initial: OrderInput;
}) {
  const [order, setOrder] = useState(initial);
  const [error, setError] = useState('');
  const [saving, start] = useTransition();

  const productOf = (id: string) => products.find((p) => p.id === id);
  const listPrice = (l: OrderLineInput) => {
    const p = productOf(l.productId);
    return p?.variants.find((v) => v.name === l.variant)?.price ?? p?.price ?? 0;
  };
  const setLine = (i: number, patch: Partial<OrderLineInput>) =>
    setOrder((o) => ({ ...o, lines: o.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const pickProduct = (i: number, productId: string) => {
    const p = productOf(productId);
    setLine(i, { productId, variant: '', unitPrice: p && !p.variants.length ? String(p.price) : '' });
  };
  const pickVariant = (i: number, variant: string) => {
    const v = productOf(order.lines[i].productId)?.variants.find((x) => x.name === variant);
    setLine(i, { variant, unitPrice: v ? String(v.price) : '' });
  };
  const pickArea = (area: DeliveryArea) =>
    setOrder((o) => ({ ...o, area, deliveryFee: fees[area] !== null ? String(fees[area]) : o.deliveryFee }));

  const itemsTotal = order.lines.reduce((sum, l) => sum + (Number(l.unitPrice) || 0) * (Number(l.quantity) || 0), 0);
  const fee = Number(order.deliveryFee) || 0;
  const field = (key: 'name' | 'phone' | 'address' | 'note') => ({
    value: order[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setOrder((o) => ({ ...o, [key]: e.target.value })),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    start(async () => {
      const res = await saveOrder(order);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <section className="space-y-3">
        <h2 className="font-semibold">Items</h2>
        {order.lines.map((line, i) => {
          const p = productOf(line.productId);
          const list = listPrice(line);
          const changed = line.unitPrice !== '' && p && Number(line.unitPrice) !== list;
          return (
            <div key={i} className="grid gap-2 rounded-control border border-line p-3 sm:grid-cols-[1fr_9rem_5rem_8rem_auto] sm:items-end">
              <div>
                <label className={label} htmlFor={`product-${i}`}>Product</label>
                <select id={`product-${i}`} className={input} value={line.productId} onChange={(e) => pickProduct(i, e.target.value)} required>
                  <option value="">Choose…</option>
                  {products.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.title} · {taka(x.price)}
                      {!x.variants.length && x.stock <= 0 ? ' · out of stock' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label} htmlFor={`variant-${i}`}>Size / colour</label>
                <select
                  id={`variant-${i}`}
                  className={input}
                  value={line.variant}
                  onChange={(e) => pickVariant(i, e.target.value)}
                  disabled={!p?.variants.length}
                  required={Boolean(p?.variants.length)}
                >
                  <option value="">{p?.variants.length ? 'Choose…' : '—'}</option>
                  {p?.variants.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                      {v.stock <= 0 ? ' (out)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label} htmlFor={`qty-${i}`}>Qty</label>
                <input id={`qty-${i}`} className={input} type="number" min={1} max={99} step={1} value={line.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} required />
              </div>
              <div>
                <label className={label} htmlFor={`price-${i}`}>Price each</label>
                <input id={`price-${i}`} className={input} type="number" min={0} step="1" value={line.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} required />
                {changed && <p className="mt-1 text-xs text-warning-strong">Catalog {taka(list)}</p>}
              </div>
              <button
                type="button"
                onClick={() => setOrder((o) => ({ ...o, lines: o.lines.filter((_, j) => j !== i) }))}
                disabled={order.lines.length === 1}
                className={`${btnDanger} min-h-11 px-3`}
                aria-label="Remove this item"
              >
                ✕
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => setOrder((o) => ({ ...o, lines: [...o.lines, { productId: '', variant: '', quantity: '1', unitPrice: '' }] }))}
          className={btnGhost}
          disabled={order.lines.length >= 20}
        >
          + Add item
        </button>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="name">Customer name</label>
          <input id="name" className={input} {...field('name')} maxLength={100} required />
        </div>
        <div>
          <label className={label} htmlFor="phone">Mobile number</label>
          <input id="phone" className={input} type="tel" {...field('phone')} placeholder="01712345678" required />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="address">Delivery address</label>
          <textarea id="address" className={input} rows={2} {...field('address')} maxLength={500} required />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="note">Note</label>
          <input id="note" className={input} {...field('note')} maxLength={300} placeholder="Agreed discount, gift wrap, call before delivery…" />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Delivery</h2>
        <div className="flex flex-wrap items-end gap-2">
          {(Object.keys(AREA_LABEL) as DeliveryArea[]).map((area) => (
            <button
              key={area}
              type="button"
              onClick={() => pickArea(area)}
              aria-pressed={order.area === area}
              className={`rounded-chip border px-3 py-2 text-sm ${order.area === area ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-zinc-600'}`}
            >
              {AREA_LABEL[area]}
              {fees[area] !== null && ` · ${taka(fees[area]!)}`}
            </button>
          ))}
          <div>
            <label className={label} htmlFor="fee">Delivery charge</label>
            <input
              id="fee"
              className={`${input} w-32`}
              type="number"
              min={0}
              step="1"
              value={order.deliveryFee}
              onChange={(e) => setOrder((o) => ({ ...o, deliveryFee: e.target.value }))}
            />
          </div>
        </div>
        <p className={hint}>Filled from your shop policies when you pick the area. Change it if you agreed something else.</p>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-sm">
          Items {taka(itemsTotal)} + delivery {taka(fee)} ={' '}
          <span className="text-lg font-bold tabular-nums">{taka(itemsTotal + fee)}</span> to collect
        </p>
        <button className={btn} disabled={saving}>
          {saving ? 'Saving…' : order.orderId ? 'Save changes' : 'Create order and send to customer'}
        </button>
      </div>
      {error && (
        <p className={errorBox} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

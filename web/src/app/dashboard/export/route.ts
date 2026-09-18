import { requireMerchant } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { csvFile } from '@/lib/csv';

// A merchant's data belongs to the merchant. Products, orders and customers as CSV, readable by Excel and by
// every courier and accounting tool in Bangladesh — and the first half of offboarding, so leaving ChatNab is
// never a reason to stay.

const SETS = {
  products: {
    table: 'products',
    columns: 'sku, title_en, title_bn, title_banglish, brand, category, price_bdt, discount_price_bdt, stock_quantity, is_active, description, custom_notes',
    order: 'created_at',
  },
  orders: { table: 'orders', columns: 'order_number, status, total_bdt, payment_method, created_at, shipping_address, items', order: 'created_at' },
  customers: { table: 'customers', columns: 'name, phone, channel, created_at', order: 'created_at' },
} as const;

type SetName = keyof typeof SETS;

export async function GET(request: Request) {
  const { supabase, tenant, user } = await requireMerchant();
  const name = new URL(request.url).searchParams.get('set') ?? '';
  if (!(name in SETS)) return Response.json({ error: 'Unknown export.' }, { status: 400 });

  const set = SETS[name as SetName];
  const { data, error } = await supabase.from(set.table).select(set.columns).eq('tenant_id', tenant.id).order(set.order, { ascending: false }).limit(10_000);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // The column list is chosen from SETS, not from the request, but it is still a runtime string: the typed
  // client cannot narrow it, so the row shape is asserted here.
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const headers = set.columns.split(',').map((c) => c.trim());
  const csv = csvFile(headers, rows);

  await audit('data.exported', { actorId: user.id, tenantId: tenant.id, detail: { set: name, rows: rows.length } });

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${tenant.slug}-${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

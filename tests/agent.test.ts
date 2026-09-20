import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb, opsOn, written, type FakeDb, type Handler } from './fake-supabase.js';

// The sales agent's tool loop, and the promises the tools make to a shop: every price on an order comes from
// the shop's own rows, never from the model's arguments, and nothing is sold that is not in stock. A model
// that asks to sell a saree at 5 taka is the case these tests exist for.

const generateContent = vi.fn();
let db: FakeDb;

vi.mock('@/lib/gemini', () => ({ GEMINI_MODEL: 'test-model', generateContent: (...args: unknown[]) => generateContent(...args) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));

const { runAgent } = await import('../web/src/lib/agent.js');

const SAREE = 'aaaaaaaa-0000-4000-8000-000000000001';
const KURTI = 'bbbbbbbb-0000-4000-8000-000000000002';

const TENANT = {
  id: 'a3f1c0de-0000-4000-8000-000000000001',
  name: 'Rupali Boutique',
  business_category: 'sarees and kurtis',
  policies: { deliveryInsideDhaka: '60 taka', deliveryOutsideDhaka: '120 taka' },
};

// A model turn: either tool calls, or the final words to the customer.
const says = (text: string) => ({ text, functionCalls: [], candidates: [{ content: { role: 'model', parts: [{ text }] } }], usageMetadata: {} });
const calls = (...fns: { name: string; args: Record<string, unknown> }[]) => ({
  text: '',
  functionCalls: fns.map((f, i) => ({ id: `call-${i}`, name: f.name, args: f.args })),
  // Carries the thought signature Gemini needs handed back on the next turn.
  candidates: [{ content: { role: 'model', parts: fns.map((f) => ({ functionCall: { name: f.name, args: f.args } })) } }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
});

const run = (overrides: Record<string, Handler> = {}, input: Record<string, unknown> = {}) => {
  db = fakeDb({
    'rpc:search_products': { data: [{ id: SAREE, title_en: 'Silk Saree', price_bdt: 2500, stock_quantity: 4 }] },
    product_searches: { data: null },
    conversations: { data: null },
    customers: { data: null },
    orders: { data: null },
    variants: { data: [] },
    products: { data: [] },
    ...overrides,
  });
  return runAgent({
    tenant: TENANT,
    customerId: 'c0000000-0000-4000-8000-00000000000c',
    conversationId: 'd0000000-0000-4000-8000-00000000000d',
    history: [],
    userText: 'Silk saree dekhao',
    ...input,
  } as Parameters<typeof runAgent>[0]);
};

beforeEach(() => generateContent.mockReset());

describe('the tool loop', () => {
  it('runs a tool, feeds the result back, and answers with what the model then says', async () => {
    generateContent
      .mockResolvedValueOnce(calls({ name: 'search_products', args: { query: 'silk saree' } }))
      .mockResolvedValueOnce(says('Amader kache Silk Saree ache, 2500 taka.'));

    const result = await run();

    expect(result.text).toBe('Amader kache Silk Saree ache, 2500 taka.');
    expect(result.toolCalls).toEqual([{ name: 'search_products', args: { query: 'silk saree' } }]);
    expect(generateContent).toHaveBeenCalledTimes(2);

    // The model's own turn goes back unchanged, then the tool result as a user turn. Reordering or rewriting
    // these loses the thought signature and Gemini rejects the next request.
    const second = generateContent.mock.calls[1][0] as { contents: { role?: string; parts?: unknown[] }[] };
    expect(second.contents.at(-2)?.role).toBe('model');
    expect(second.contents.at(-1)).toMatchObject({ role: 'user' });
    const sent = second.contents.at(-1)!.parts![0] as { functionResponse: { name: string; response: { products: unknown[] } } };
    expect(sent.functionResponse.name).toBe('search_products');
    expect(sent.functionResponse.response.products).toHaveLength(1);
  });

  it('adds up the tokens it spent across every turn, thinking included', async () => {
    generateContent
      .mockResolvedValueOnce({ ...calls({ name: 'search_products', args: {} }), usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30 } })
      .mockResolvedValueOnce({ ...says('ok'), usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 10 } });

    const result = await run();
    expect(result.promptTokens).toBe(300);
    expect(result.outputTokens).toBe(60); // 20 + 30 thinking + 10
  });

  it('stops after five rounds instead of calling the model forever', async () => {
    generateContent.mockResolvedValue(calls({ name: 'search_products', args: { query: 'again' } }));

    const result = await run();

    expect(generateContent).toHaveBeenCalledTimes(5);
    // No final words, so the customer gets the fallback rather than an empty message.
    expect(result.text).toContain('Dukkhito');
  });

  it('tells the model a tool failed instead of dying with it', async () => {
    generateContent
      .mockResolvedValueOnce(calls({ name: 'search_products', args: { query: 'silk' } }))
      .mockResolvedValueOnce(says('Amader team confirm korbe.'));

    const result = await run({ 'rpc:search_products': () => ({ error: { message: 'connection lost' } }) });

    expect(result.text).toBe('Amader team confirm korbe.');
    const sent = (generateContent.mock.calls[1][0] as { contents: { parts?: unknown[] }[] }).contents.at(-1)!.parts![0] as {
      functionResponse: { response: { error: string } };
    };
    expect(sent.functionResponse.response.error).toMatch(/Tool failed/);
  });
});

describe('show_products', () => {
  const four = [SAREE, KURTI, 'cccccccc-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000004'];
  const five = [...four, 'eeeeeeee-0000-4000-8000-000000000005'];

  it('shows at most four cards however many the model asks for', async () => {
    generateContent.mockResolvedValueOnce(calls({ name: 'show_products', args: { product_ids: five } })).mockResolvedValueOnce(says('Ei gulo dekhun.'));

    const result = await run({
      products: { data: five.map((id, i) => ({ id, title_en: `Item ${i}`, price_bdt: 1000, discount_price_bdt: null, stock_quantity: 2, image_urls: [] })) },
    });

    expect(result.products).toHaveLength(4);
    // The cap is applied to the ids before the query, not just to the cards afterwards.
    expect(opsOn(db, 'products')[0].filters).toContainEqual(['in', 'id', four]);
  });

  it('refuses ids the model invented rather than took from a search', async () => {
    generateContent
      .mockResolvedValueOnce(calls({ name: 'show_products', args: { product_ids: ['silk-saree-1', '42'] } }))
      .mockResolvedValueOnce(says('Ektu wait korun.'));

    const result = await run();

    expect(result.products).toEqual([]);
    expect(opsOn(db, 'products')).toHaveLength(0); // never reached the database
  });
});

describe('place_order', () => {
  const order = (args: Record<string, unknown>) => ({
    name: 'place_order',
    args: {
      customer_name: 'Rumana',
      phone: '01712345678',
      address: 'House 4, Road 12, Dhanmondi, Dhaka',
      delivery_area: 'inside_dhaka',
      items: [{ product_id: SAREE, quantity: 1 }],
      ...args,
    },
  });
  const inStock = { data: [{ id: SAREE, sku: 'SAREE-1', title_en: 'Silk Saree', price_bdt: 2500, discount_price_bdt: null, stock_quantity: 4, is_active: true }] };

  const place = (args: Record<string, unknown>, overrides: Record<string, Handler> = {}) => {
    generateContent.mockResolvedValueOnce(calls(order(args))).mockResolvedValueOnce(says('Order confirm hoyeche.'));
    return run({ products: inStock, ...overrides });
  };

  // What the tool told the model, which is what the model repeats to the customer.
  const toolReply = () =>
    ((generateContent.mock.calls[1][0] as { contents: { parts?: unknown[] }[] }).contents.at(-1)!.parts![0] as {
      functionResponse: { response: Record<string, unknown> };
    }).functionResponse.response;

  it('charges the catalog price, not the price the model asked for', async () => {
    await place({ items: [{ product_id: SAREE, quantity: 2, unit_price: 5 }] });

    const row = written(db, 'orders') as { total_bdt: number; items: { unit_price: number }[]; courier_fee_bdt: number };
    expect(row.items[0].unit_price).toBe(2500);
    expect(row.total_bdt).toBe(5000);
    expect(row.courier_fee_bdt).toBe(60); // from the shop's policy, not from the model
  });

  it('charges a variant at its own price and refuses more than its own stock', async () => {
    const variants = { data: [{ product_id: SAREE, name: 'L', price_bdt: 2900, stock_quantity: 3 }] };

    await place({ items: [{ product_id: SAREE, quantity: 2, variant: 'L' }] }, { variants });
    const row = written(db, 'orders') as { items: { unit_price: number; title: string }[] };
    expect(row.items[0].unit_price).toBe(2900);
    expect(row.items[0].title).toBe('Silk Saree (L)');

    generateContent.mockReset();
    await place({ items: [{ product_id: SAREE, quantity: 9, variant: 'L' }] }, { variants });
    expect(toolReply().error).toMatch(/Only 3 of Silk Saree \(L\)/);
    expect(opsOn(db, 'orders')).toHaveLength(0);
  });

  it('will not oversell what is on the shelf', async () => {
    await place({ items: [{ product_id: SAREE, quantity: 5 }] });
    expect(toolReply().error).toMatch(/Only 4 of Silk Saree/);
    expect(opsOn(db, 'orders')).toHaveLength(0);
  });

  it('asks for a real Bangladeshi number and a real address before taking anything', async () => {
    await place({ phone: '12345' });
    expect(toolReply().error).toMatch(/Invalid phone/);

    generateContent.mockReset();
    await place({ address: 'Dhaka' });
    expect(toolReply().error).toMatch(/full delivery address/);
    expect(opsOn(db, 'orders')).toHaveLength(0);
  });

  it('asks which side of Dhaka when the shop charges differently, rather than guessing', async () => {
    await place({ delivery_area: undefined });
    expect(toolReply().error).toMatch(/inside or outside Dhaka/);
  });

  it('treats a repeated call as the same order, not a second one', async () => {
    await place({}, { orders: (op) => (op.method === 'insert' ? { error: { code: '23505' } } : { data: { order_number: 'RB-1042', total_bdt: 2500, courier_fee_bdt: 60 } }) });

    const reply = toolReply();
    expect(reply.already_placed).toBe(true);
    expect(reply.order_number).toBe('RB-1042');
  });
});

describe('request_human', () => {
  it('flags the conversation with the reason the model gave', async () => {
    generateContent
      .mockResolvedValueOnce(calls({ name: 'request_human', args: { reason: 'Customer is bargaining below the listed price' } }))
      .mockResolvedValueOnce(says('Amader team ekhuni reply debe.'));

    await run();

    const update = opsOn(db, 'conversations').find((op) => op.method === 'update');
    expect(update?.args[0]).toMatchObject({ needs_human: true, handoff_reason: 'Customer is bargaining below the listed price' });
  });
});

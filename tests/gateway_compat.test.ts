import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { systemPrompt, TOOLS } from '../web/src/lib/agent.js';
import { anthropicGenerateContent, toMessages } from '../web/src/lib/anthropic-compatible.js';
import { customGenerateContent, type CustomEndpoint } from '../web/src/lib/openai-compatible.js';

// What ChatNab actually puts on the wire when the platform admin points it at an in-house gateway (Mavs).
// The adapters are driven for real with fetch stubbed, and every captured request is written to
// tests/fixtures/gateway/, so a gateway can be tested against ChatNab's true payloads instead of guesses.
// The assertions are the contract: what the gateway must hand back unchanged on the next turn.

type Params = Parameters<typeof customGenerateContent>[0];

const FIXTURES = new URL('./fixtures/gateway/', import.meta.url);
const ENDPOINT: CustomEndpoint = { baseUrl: 'http://localhost:8081/v1', model: 'gemini-3.8-flash', apiKey: 'mavs-test-key-not-real' };
const SECRET_HEADERS = new Set(['authorization', 'x-api-key']);

// 1x1 pixels. Real, decodable, and carrying nothing of anybody's.
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPEG_1PX =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJ' +
  'CQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEA' +
  'AAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6' +
  'Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx' +
  '8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';

const TENANT = { id: 'a3f1c0de-0000-4000-8000-000000000001', name: 'Rupali Boutique', business_category: 'sarees and kurtis' };
const CONFIG = { systemInstruction: systemPrompt(TENANT), tools: [{ functionDeclarations: TOOLS }], temperature: 0.5 };

// ---------------------------------------------------------------------------
// What the gateway hands back. The opaque fields are the point: ChatNab does not
// read them, cannot regenerate them, and sends them straight back on turn 2.
// ---------------------------------------------------------------------------

const OPENAI_TOOL_TURN = {
  id: 'chatcmpl-mavs-0001',
  object: 'chat.completion',
  created: 1758182400,
  model: 'gemini-3.8-flash',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_01HZQS7N4KMAVS',
            type: 'function',
            function: { name: 'search_products', arguments: '{"query":"neel saree blue শাড়ি"}' },
            // Provider-specific and required back verbatim by Google's OpenAI-compatible layer.
            extra_content: { google: { thought_signature: 'CqgBAdHtim9NQVZTLWR1bW15LXNpZ25hdHVyZS1ub3QtcmVhbA==' } },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
  usage: { prompt_tokens: 2411, completion_tokens: 38, total_tokens: 2449 },
};

const OPENAI_FINAL_TURN = {
  id: 'chatcmpl-mavs-0002',
  object: 'chat.completion',
  created: 1758182402,
  model: 'gemini-3.8-flash',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Neel Jamdani ache, 3200 taka. Dekhte chan?' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 2680, completion_tokens: 21, total_tokens: 2701 },
};

const ANTHROPIC_TOOL_TURN = {
  id: 'msg_01MavsGatewayFixture',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-6',
  content: [
    // Extended thinking: opaque, signed, and rejected by the API if it comes back altered.
    { type: 'thinking', thinking: 'Customer wants a blue saree. Search the catalog first.', signature: 'ErUBCkYIBRgCKkBNQVZTLWR1bW15LXRoaW5raW5nLXNpZw==' },
    { type: 'text', text: 'Ek minute, dekhchi.' },
    { type: 'tool_use', id: 'toolu_01A9BqMavsFixture', name: 'search_products', input: { query: 'neel saree blue শাড়ি' } },
  ],
  stop_reason: 'tool_use',
  stop_sequence: null,
  usage: { input_tokens: 2411, output_tokens: 96 },
};

const ANTHROPIC_FINAL_TURN = {
  id: 'msg_01MavsGatewayFixture2',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-6',
  content: [{ type: 'text', text: 'Neel Jamdani ache, 3200 taka. Dekhte chan?' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 2680, output_tokens: 21 },
};

// What runTool('search_products') returns for this shop, shape copied from the live rows.
const TOOL_RESULT = {
  products: [
    {
      id: 'b7d2e4a1-0000-4000-8000-00000000000a',
      title: 'Neel Jamdani Saree',
      title_bn: 'নীল জামদানি শাড়ি',
      brand: null,
      category: 'saree',
      price_bdt: 3200,
      regular_price_bdt: 4000,
      stock: 5,
      description: 'Handloom cotton jamdani, 12 hand with blouse piece.',
      notes: null,
      photos: 3,
    },
  ],
};

// ---------------------------------------------------------------------------

type Captured = { method: string; url: string; headers: Record<string, string>; body: Record<string, unknown> };

let captured: Captured[] = [];
let queue: unknown[] = [];
let realFetch: typeof globalThis.fetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
  captured = [];
  queue = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const req = input instanceof Request ? input : null;
    const headers: Record<string, string> = {};
    new Headers(init.headers ?? req?.headers).forEach((value, key) => {
      headers[key] = SECRET_HEADERS.has(key) ? '<REDACTED>' : value;
    });
    const raw = (init.body ?? (req ? await req.text() : '{}')) as string;
    captured.push({ method: init.method ?? req?.method ?? 'POST', url: req?.url ?? String(input), headers, body: JSON.parse(raw) });
    return new Response(JSON.stringify(queue.shift() ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function save(name: string, description: string, request: Captured) {
  mkdirSync(FIXTURES, { recursive: true });
  const json = JSON.stringify({ description, ...request }, null, 2);
  // A leaked key is a fixture nobody can share.
  expect(json).not.toContain(ENDPOINT.apiKey);
  writeFileSync(new URL(`chatnab-${name}.json`, FIXTURES), `${json}\n`);
}

// Turn 1, then the model's own turn plus the tool result back in: exactly what agent.ts does between steps.
async function toolRoundTrip(call: (p: Params, e: CustomEndpoint) => Promise<{ candidates?: unknown[]; functionCalls?: unknown[] }>, base: unknown[]) {
  const first = { model: ENDPOINT.model, contents: base, config: CONFIG } as Params;
  const res = await call(first, ENDPOINT);
  const content = (res.candidates as { content: unknown }[])[0].content;
  const parts = (res.functionCalls as { id?: string; name?: string }[]).map((fc) => ({
    functionResponse: { id: fc.id, name: fc.name, response: TOOL_RESULT },
  }));
  await call({ ...first, contents: [...base, content, { role: 'user', parts }] } as Params, ENDPOINT);
}

describe('unsupported image formats on the Anthropic Messages path', () => {
  const user = (parts: unknown[]) => toMessages({ model: 'm', contents: [{ role: 'user', parts }] } as Params);
  const image = (mimeType: string, data = PNG_1PX) => ({ inlineData: { mimeType, data } });

  it('sends a JPEG as an image block', () => {
    const blocks = user([image('image/jpeg', JPEG_1PX)])[0].content as { type: string; source: { media_type: string; data: string } }[];
    expect(blocks[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: JPEG_1PX } });
  });

  it('sends a PNG as an image block', () => {
    const blocks = user([image('image/png')])[0].content as { type: string; source: { media_type: string } }[];
    expect(blocks[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } });
  });

  it('turns an unsupported format into an explanatory text block instead of dropping it', () => {
    const blocks = user([image('image/heic')])[0].content as { type: string; text: string }[];
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
    expect(blocks[0].text).toContain('image/heic');
  });

  it('keeps the rest of the message when one image cannot be carried', () => {
    const blocks = user([image('image/heic'), { text: 'ei saree ta ache?' }])[0].content as { type: string; text?: string }[];
    expect(blocks.map((b) => b.type)).toEqual(['text', 'text']);
    expect(blocks[1].text).toBe('ei saree ta ache?');
  });

  it('never leaves a photo-only turn empty', () => {
    const messages = user([image('image/heic')]);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).not.toHaveLength(0);
  });
});

describe('OpenAI-compatible wire payloads', () => {
  it('sends text and writes the fixture', async () => {
    queue = [OPENAI_FINAL_TURN];
    await customGenerateContent(
      {
        model: ENDPOINT.model,
        contents: [
          { role: 'user', parts: [{ text: 'assalamu alaikum, neel saree ache?' }] },
          { role: 'model', parts: [{ text: 'Walaikum assalam! Ji ache, ek minute.' }] },
          { role: 'user', parts: [{ text: 'dam koto?' }] },
        ],
        config: CONFIG,
      } as Params,
      ENDPOINT,
    );
    expect(captured[0].body.messages).toHaveLength(4); // system + the three turns
    save('openai-text', 'Plain multi-turn chat. Tools are always declared; content is a bare string when every part is text.', captured[0]);
  });

  it('sends a photo as an image_url data URI and writes the fixture', async () => {
    queue = [OPENAI_FINAL_TURN];
    await customGenerateContent(
      {
        model: ENDPOINT.model,
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: JPEG_1PX } }, { text: 'eita ache?' }] }],
        config: CONFIG,
      } as Params,
      ENDPOINT,
    );
    const parts = (captured[0].body.messages as { role: string; content: { type: string; image_url?: { url: string } }[] }[])[1].content;
    expect(parts[0].image_url!.url).toBe(`data:image/jpeg;base64,${JPEG_1PX}`);
    save('openai-image', 'Photo + text. Mixed parts switch content to an array; the image rides as a base64 data: URI.', captured[0]);
  });

  it('round-trips the gateway tool call untouched, including fields it never reads', async () => {
    queue = [OPENAI_TOOL_TURN, OPENAI_FINAL_TURN];
    await toolRoundTrip(customGenerateContent, [{ role: 'user', parts: [{ text: 'neel saree ache?' }] }]);

    const sent = (captured[1].body.messages as Record<string, unknown>[]).filter((m) => m.role === 'assistant' || m.role === 'tool');
    const assistant = sent[0] as { tool_calls: unknown[] };
    // The contract: byte for byte the object the gateway produced, thought_signature and all.
    expect(assistant.tool_calls[0]).toEqual(OPENAI_TOOL_TURN.choices[0].message.tool_calls[0]);
    expect(sent[1]).toMatchObject({ role: 'tool', tool_call_id: 'call_01HZQS7N4KMAVS' });

    save('openai-tool-turn1', 'Turn 1: the request that makes the model call search_products.', captured[0]);
    save(
      'openai-tool-turn2',
      "Turn 2: the assistant tool_calls object is the gateway's own, echoed back unchanged (note extra_content.google.thought_signature), followed by the tool result.",
      captured[1],
    );
  });
});

describe('Anthropic-compatible wire payloads', () => {
  it('sends text and writes the fixture', async () => {
    queue = [ANTHROPIC_FINAL_TURN];
    await anthropicGenerateContent(
      {
        model: ENDPOINT.model,
        contents: [
          { role: 'user', parts: [{ text: 'assalamu alaikum, neel saree ache?' }] },
          { role: 'model', parts: [{ text: 'Walaikum assalam! Ji ache, ek minute.' }] },
          { role: 'user', parts: [{ text: 'dam koto?' }] },
        ],
        config: CONFIG,
      } as Params,
      ENDPOINT,
    );
    expect(captured[0].url).toBe('http://localhost:8081/v1/messages');
    expect(captured[0].body.system).toContain('Rupali Boutique');
    save('anthropic-text', 'Plain multi-turn chat. The system prompt is a top-level field, not a message.', captured[0]);
  });

  it('sends a photo as a base64 image block and writes the fixture', async () => {
    queue = [ANTHROPIC_FINAL_TURN];
    await anthropicGenerateContent(
      {
        model: ENDPOINT.model,
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: JPEG_1PX } }, { text: 'eita ache?' }] }],
        config: CONFIG,
      } as Params,
      ENDPOINT,
    );
    const blocks = (captured[0].body.messages as { content: { type: string; source?: { media_type: string } }[] }[])[0].content;
    expect(blocks[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } });
    save(
      'anthropic-image',
      'Photo + text as content blocks. Only jpeg/png/gif/webp reach the gateway as images; anything else arrives as an explanatory text block.',
      captured[0],
    );
  });

  it('round-trips the gateway assistant blocks untouched, thinking signature included', async () => {
    queue = [ANTHROPIC_TOOL_TURN, ANTHROPIC_FINAL_TURN];
    await toolRoundTrip(anthropicGenerateContent, [{ role: 'user', parts: [{ text: 'neel saree ache?' }] }]);

    const messages = captured[1].body.messages as { role: string; content: unknown }[];
    const assistant = messages.find((m) => m.role === 'assistant')!;
    // The whole content array comes back as the gateway sent it: thinking block, signature, text, tool_use.
    expect(assistant.content).toEqual(ANTHROPIC_TOOL_TURN.content);
    expect((messages.at(-1)!.content as { tool_use_id: string }[])[0].tool_use_id).toBe('toolu_01A9BqMavsFixture');

    save('anthropic-tool-turn1', 'Turn 1: the request that makes the model call search_products.', captured[0]);
    save(
      'anthropic-tool-turn2',
      "Turn 2: the assistant content array is the gateway's own, echoed back unchanged (thinking block and its signature included), followed by the tool_result.",
      captured[1],
    );
  });
});

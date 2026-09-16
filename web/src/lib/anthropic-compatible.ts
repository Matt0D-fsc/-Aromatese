import Anthropic from '@anthropic-ai/sdk';
import type { GoogleGenAI } from '@google/genai';
import type { CustomEndpoint } from '@/lib/openai-compatible';

type Params = Parameters<GoogleGenAI['models']['generateContent']>[0];
type Result = Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;

// Talks to an in-house model over the Anthropic Messages API (/v1/messages), e.g. a Claude-compatible gateway.
// Like openai-compatible.ts, it converts Gemini-shaped requests and responses so the sales agent and AI fill
// run unchanged on either engine.

type Part = {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  functionCall?: { id?: string; name?: string; args?: unknown };
  functionResponse?: { id?: string; name?: string; response?: unknown };
};
type Content = { role?: string; parts?: Part[]; anthropicContent?: Anthropic.ContentBlock[] };
type Declaration = { name?: string; description?: string; parametersJsonSchema?: unknown; parameters?: unknown };

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function toMessages(params: Params): Anthropic.MessageParam[] {
  const contents = (typeof params.contents === 'string' ? [{ role: 'user', parts: [{ text: params.contents }] }] : params.contents) as Content[];

  return contents.flatMap((content): Anthropic.MessageParam[] => {
    const parts = content.parts ?? [];

    if (content.role === 'model') {
      // Echo the server's own blocks back unchanged: thinking blocks must be returned as-is on the next turn.
      if (content.anthropicContent) return [{ role: 'assistant', content: content.anthropicContent }];
      const blocks = parts.flatMap((p): Anthropic.ContentBlockParam[] => {
        if (p.functionCall) return [{ type: 'tool_use', id: p.functionCall.id ?? `toolu_${Date.now()}`, name: p.functionCall.name ?? '', input: p.functionCall.args ?? {} }];
        return p.text ? [{ type: 'text', text: p.text }] : [];
      });
      return blocks.length ? [{ role: 'assistant', content: blocks }] : [];
    }

    const blocks = parts.flatMap((p): Anthropic.ContentBlockParam[] => {
      if (p.functionResponse) {
        return [{ type: 'tool_result', tool_use_id: p.functionResponse.id ?? '', content: JSON.stringify(p.functionResponse.response ?? {}) }];
      }
      if (p.text) return [{ type: 'text', text: p.text }];
      const mimeType = p.inlineData?.mimeType ?? '';
      if (IMAGE_TYPES.includes(mimeType)) {
        return [{ type: 'image', source: { type: 'base64', media_type: mimeType as Anthropic.Base64ImageSource['media_type'], data: p.inlineData?.data ?? '' } }];
      }
      // The Messages API has no audio input: tell the model, so it asks for text instead of the reply failing.
      if (mimeType.startsWith('audio/')) {
        return [{ type: 'text', text: '[The customer sent a voice note, but this AI engine cannot listen to audio. Politely ask them to type their message.]' }];
      }
      return [];
    });
    return blocks.length ? [{ role: 'user', content: blocks }] : [];
  });
}

function toTools(params: Params): Anthropic.Tool[] {
  const tools = (params.config?.tools ?? []) as { functionDeclarations?: Declaration[] }[];
  return tools
    .flatMap((t) => t.functionDeclarations ?? [])
    .map((d) => ({
      name: d.name ?? '',
      description: d.description,
      input_schema: (d.parametersJsonSchema ?? d.parameters ?? { type: 'object', properties: {} }) as Anthropic.Tool.InputSchema,
    }));
}

export async function anthropicGenerateContent(params: Params, endpoint: CustomEndpoint): Promise<Result> {
  const client = new Anthropic({
    // Sent as both x-api-key and Bearer, so gateways that accept either style work.
    apiKey: endpoint.apiKey ?? 'not-set',
    authToken: endpoint.apiKey ?? undefined,
    // The SDK appends /v1/messages itself; accept base URLs typed with or without /v1.
    baseURL: endpoint.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, ''),
    maxRetries: 1,
    timeout: 120_000,
  });

  const system = params.config?.systemInstruction;
  const tools = toTools(params);
  const message = await client.messages.create({
    model: endpoint.model,
    max_tokens: 16000,
    ...(typeof system === 'string' && system ? { system } : {}),
    ...(tools.length ? { tools } : {}),
    messages: toMessages(params),
  });

  const text = message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('')
    .trim();
  const functionCalls = message.content.flatMap((block) => (block.type === 'tool_use' ? [{ id: block.id, name: block.name, args: block.input }] : []));

  return {
    text,
    functionCalls: functionCalls.length ? functionCalls : undefined,
    candidates: [
      {
        content: {
          role: 'model',
          parts: [...(text ? [{ text }] : []), ...functionCalls.map((fc) => ({ functionCall: fc }))],
          anthropicContent: message.content,
        },
      },
    ],
    usageMetadata: { promptTokenCount: message.usage.input_tokens, candidatesTokenCount: message.usage.output_tokens },
  } as unknown as Result;
}

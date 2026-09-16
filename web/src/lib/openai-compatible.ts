import type { GoogleGenAI } from '@google/genai';

type Params = Parameters<GoogleGenAI['models']['generateContent']>[0];
type Result = Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;

export type CustomEndpoint = { baseUrl: string; model: string; apiKey: string | null };

// Talks to an in-house model over the OpenAI-compatible /chat/completions API (vLLM, Ollama, llama.cpp, LM Studio,
// TGI, LiteLLM). Requests and responses are converted to and from Gemini's shape, so the sales agent and AI fill
// run unchanged on either engine.

type Part = {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  functionCall?: { id?: string; name?: string; args?: unknown; raw?: unknown };
  functionResponse?: { id?: string; name?: string; response?: unknown };
};
type Content = { role?: string; parts?: Part[] };
type Declaration = { name?: string; description?: string; parametersJsonSchema?: unknown; parameters?: unknown };
type ToolCall = { id?: string; type?: string; function?: { name?: string; arguments?: unknown } };

function userPart(p: Part) {
  if (p.text) return { type: 'text', text: p.text };
  const mimeType = p.inlineData?.mimeType ?? '';
  const data = p.inlineData?.data ?? '';
  if (mimeType.startsWith('image/')) return { type: 'image_url', image_url: { url: `data:${mimeType};base64,${data}` } };
  // ponytail: OpenAI-style audio input officially covers wav/mp3; browser voice notes are webm/ogg and may need transcoding.
  if (mimeType.startsWith('audio/')) return { type: 'input_audio', input_audio: { data, format: mimeType.split('/')[1] } };
  return null;
}

function toMessages(params: Params) {
  const messages: Record<string, unknown>[] = [];
  const system = params.config?.systemInstruction;
  if (typeof system === 'string' && system) messages.push({ role: 'system', content: system });

  const contents = (typeof params.contents === 'string' ? [{ role: 'user', parts: [{ text: params.contents }] }] : params.contents) as Content[];
  for (const content of contents) {
    const parts = content.parts ?? [];

    if (content.role === 'model') {
      const text = parts.map((p) => p.text ?? '').join('');
      const toolCalls = parts
        .filter((p) => p.functionCall)
        // Send the server's own tool call back untouched: some servers attach fields they require on the next turn
        // (Google's endpoint needs its thought_signature back).
        .map((p) => p.functionCall!.raw ?? { id: p.functionCall!.id, type: 'function', function: { name: p.functionCall!.name, arguments: JSON.stringify(p.functionCall!.args ?? {}) } });
      messages.push({ role: 'assistant', content: text || null, ...(toolCalls.length && { tool_calls: toolCalls }) });
      continue;
    }

    for (const p of parts.filter((x) => x.functionResponse)) {
      messages.push({ role: 'tool', tool_call_id: p.functionResponse!.id, content: JSON.stringify(p.functionResponse!.response ?? {}) });
    }
    const userParts = parts.filter((p) => !p.functionResponse).map(userPart).filter((p) => p !== null);
    if (!userParts.length) continue;
    // Plain text as a string: older servers reject the array form.
    const textOnly = userParts.every((p) => p.type === 'text');
    messages.push({ role: 'user', content: textOnly ? userParts.map((p) => (p as { text: string }).text).join('\n') : userParts });
  }
  return messages;
}

function toTools(params: Params) {
  const tools = (params.config?.tools ?? []) as { functionDeclarations?: Declaration[] }[];
  return tools
    .flatMap((t) => t.functionDeclarations ?? [])
    .map((d) => ({
      type: 'function',
      function: { name: d.name, description: d.description, parameters: d.parametersJsonSchema ?? d.parameters ?? { type: 'object', properties: {} } },
    }));
}

const parseArgs = (raw: unknown) => {
  if (typeof raw !== 'string') return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

export async function customGenerateContent(params: Params, endpoint: CustomEndpoint): Promise<Result> {
  const tools = toTools(params);
  const res = await fetch(`${endpoint.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(endpoint.apiKey && { Authorization: `Bearer ${endpoint.apiKey}` }) },
    body: JSON.stringify({
      model: endpoint.model,
      messages: toMessages(params),
      ...(params.config?.temperature !== undefined && { temperature: params.config.temperature }),
      ...(tools.length && { tools }),
      ...(params.config?.responseMimeType === 'application/json' && { response_format: { type: 'json_object' } }),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Object.assign(new Error(`In-house AI returned ${res.status}: ${detail.slice(0, 300)}`), { status: res.status });
  }

  const json = await res.json();
  const message = json.choices?.[0]?.message ?? {};
  // Reasoning models (DeepSeek-R1, Qwen3...) often inline their thinking; customers must never see it.
  const text = typeof message.content === 'string' ? message.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim() : '';
  const functionCalls = ((message.tool_calls ?? []) as ToolCall[]).map((call, i) => {
    const id = call.id || `call_${Date.now()}_${i}`;
    return { id, name: call.function?.name ?? '', args: parseArgs(call.function?.arguments), raw: { ...call, id, type: call.type ?? 'function' } };
  });

  return {
    text,
    functionCalls: functionCalls.length ? functionCalls : undefined,
    candidates: [{ content: { role: 'model', parts: [...(text ? [{ text }] : []), ...functionCalls.map((fc) => ({ functionCall: fc }))] } }],
    usageMetadata: { promptTokenCount: json.usage?.prompt_tokens ?? 0, candidatesTokenCount: json.usage?.completion_tokens ?? 0 },
  } as unknown as Result;
}

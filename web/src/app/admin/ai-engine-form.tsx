'use client';

import { useActionState, useState } from 'react';
import { btn, btnGhost, errorBox, hint, input, label, noticeBox } from '@/components/ui';
import { clearAiEngineKey, saveAiEngine, testAiEngine, type AiEngineState } from './actions';

type Props = { provider: 'gemini' | 'custom'; apiFormat: 'openai' | 'anthropic'; baseUrl: string; model: string; hasKey: boolean; geminiModel: string };

export function AiEngineForm(props: Props) {
  // Controlled fields: form actions reset uncontrolled inputs, which would wipe unsaved values after "Test".
  const [provider, setProvider] = useState(props.provider);
  const [apiFormat, setApiFormat] = useState(props.apiFormat);
  const [baseUrl, setBaseUrl] = useState(props.baseUrl);
  const [model, setModel] = useState(props.model);
  const [apiKey, setApiKey] = useState('');
  const [saved, save, saving] = useActionState<AiEngineState, FormData>(saveAiEngine, {});
  const [tested, test, testing] = useActionState<AiEngineState, FormData>(testAiEngine, {});

  const options = [
    ['gemini', `Gemini (.env) · ${props.geminiModel}`],
    ['custom', 'In-house AI'],
  ] as const;

  return (
    <form action={save} className="space-y-4">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="AI engine">
        {options.map(([value, text]) => (
          <label
            key={value}
            className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-medium ring-1 has-[:focus-visible]:ring-2 ${
              provider === value ? 'bg-zinc-900 text-white ring-zinc-900' : 'bg-white text-zinc-700 ring-zinc-300 hover:bg-zinc-50'
            }`}
          >
            <input type="radio" name="provider" value={value} checked={provider === value} onChange={() => setProvider(value)} className="sr-only" />
            {text}
          </label>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="apiFormat">API format</label>
          <select className={input} id="apiFormat" name="apiFormat" value={apiFormat} onChange={(e) => setApiFormat(e.target.value as Props['apiFormat'])}>
            <option value="openai">OpenAI Chat Completions</option>
            <option value="anthropic">Anthropic Messages (Claude-compatible)</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="baseUrl">In-house base URL</label>
          <input className={input} id="baseUrl" name="baseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:8000/v1" />
        </div>
        <p className={`${hint} sm:col-span-2 -mt-3`}>
          {apiFormat === 'anthropic'
            ? <>Claude-compatible gateways and proxies. <code>/v1/messages</code> is added automatically, so the URL works with or without <code>/v1</code>.</>
            : <>vLLM, Ollama (<code>http://localhost:11434/v1</code>), llama.cpp, LM Studio, LiteLLM. <code>/chat/completions</code> is added automatically.</>}
        </p>
        <div>
          <label className={label} htmlFor="model">Model name</label>
          <input className={input} id="model" name="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="qwen3-8b" />
        </div>
        <div>
          <label className={label} htmlFor="apiKey">API key</label>
          <input
            className={input}
            id="apiKey"
            name="apiKey"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={props.hasKey ? 'Saved. Leave blank to keep it' : 'Optional'}
          />
          {props.hasKey && (
            <button type="button" onClick={() => clearAiEngineKey()} className="mt-1 text-xs text-red-700 underline">
              Remove saved key
            </button>
          )}
        </div>
      </div>

      {saved.error && <p className={errorBox} role="alert">{saved.error}</p>}
      {saved.message && <p className={noticeBox}>{saved.message}</p>}
      {tested.error && <p className={errorBox} role="alert">{tested.error}</p>}
      {tested.message && <p className={noticeBox}>{tested.message}</p>}

      <div className="flex flex-wrap gap-2">
        <button className={btn} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button className={btnGhost} formAction={test} disabled={testing || !baseUrl.trim() || !model.trim()}>
          {testing ? 'Testing…' : 'Test in-house AI'}
        </button>
      </div>
    </form>
  );
}

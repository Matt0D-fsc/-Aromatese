'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { mediaLabel, taka, type ChatLine, type ChatProduct } from '@/lib/chat';

const MAX_RECORD_MS = 60_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const POLL_MS = 4000;
const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function ChatClient({ slug, shopName, initial, since }: { slug: string; shopName: string; initial: ChatLine[]; since: string | null }) {
  const [lines, setLines] = useState(initial);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const cursor = useRef(since);

  // Adds lines not already on screen and moves the "seen up to" cursor forward.
  const append = useCallback((incoming: ChatLine[]) => {
    const newest = incoming.at(-1)?.createdAt;
    if (newest && (!cursor.current || newest > cursor.current)) cursor.current = newest;
    setLines((l) => {
      const seen = new Set(l.map((x) => x.id));
      const fresh = incoming.filter((x) => !seen.has(x.id));
      return fresh.length ? [...l, ...fresh] : l;
    });
  }, []);

  // Staff replies arrive by polling: visitors are anonymous, so they can't subscribe to the database.
  // ponytail: one request per open chat every 4s; move to Realtime broadcast if open chats reach the thousands.
  useEffect(() => {
    const timer = setInterval(async () => {
      if (document.hidden) return;
      const query = cursor.current ? `?after=${encodeURIComponent(cursor.current)}` : '';
      const res = await fetch(`/api/chat/${encodeURIComponent(slug)}${query}`).catch(() => null);
      if (res?.ok) append((await res.json()).messages ?? []);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [slug, append]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines, busy]);

  async function send(text: string, file?: File) {
    const clean = text.trim();
    if (busy || (!clean && !file)) return;
    if (file && file.size > MAX_FILE_BYTES) return setError('File is too large (max 5 MB).');

    const kind = file ? (file.type.startsWith('audio/') ? 'audio' : 'image') : 'text';
    const localUrl = file ? URL.createObjectURL(file) : undefined;
    setLines((l) => [...l, { id: crypto.randomUUID(), from: 'customer', kind, text: clean, products: [], orderNumber: null, localUrl }]);
    setDraft('');
    setError('');
    setBusy(true);

    const body = new FormData();
    if (clean) body.set('text', clean);
    if (file) body.set('file', file);
    try {
      const res = await fetch(`/api/chat/${encodeURIComponent(slug)}`, { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? 'Message failed. Try again.');
      else if (data.reply) append([data.reply]);
      else if (!data.staff)
        setLines((l) => [
          ...l,
          { id: crypto.randomUUID(), from: 'bot', kind: 'text', text: 'Dhonnobad! Amader shop team ekhane ektu porei reply debe.', products: [], orderNumber: null },
        ]);
    } catch {
      setError('No connection. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecording() {
    if (recorder.current) return recorder.current.stop();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setError('Allow microphone access to send a voice note.');
    }
    const type = AUDIO_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      setRecording(false);
      const blob = new Blob(chunks, { type: rec.mimeType });
      if (blob.size > 0) send('', new File([blob], 'voice-note', { type: rec.mimeType }));
    };
    rec.start();
    recorder.current = rec;
    setRecording(true);
    setError('');
    setTimeout(() => rec.state === 'recording' && rec.stop(), MAX_RECORD_MS);
  }

  return (
    <div className="mx-auto flex h-dvh max-w-2xl flex-col bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white px-4 py-3">
        <p className="font-semibold">{shopName}</p>
        <p className="text-xs text-zinc-500">AI sales assistant · Bangla, Banglish or English</p>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {lines.length === 0 && (
          <Bubble mine={false}>
            Assalamu alaikum! 👋 Ki khujchen? Type a message, send a voice note 🎤 or a photo 📷 of what you want.
          </Bubble>
        )}
        {lines.map((line) => (
          <div key={line.id} className="space-y-2">
            <Bubble mine={line.from === 'customer'}>
              {line.from === 'agent' && <p className="mb-0.5 text-xs font-semibold text-emerald-700">Team member</p>}
              {line.localUrl && line.kind === 'image' && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={line.localUrl} alt="Your photo" className="mb-1 max-h-48 rounded-lg" />
              )}
              {line.localUrl && line.kind === 'audio' && <audio controls src={line.localUrl} className="max-w-full" />}
              {!line.localUrl && line.kind !== 'text' && <p className="opacity-70">{mediaLabel(line.kind)}</p>}
              {line.text && <p className="whitespace-pre-wrap">{line.text}</p>}
              {line.orderNumber && <p className="mt-1 text-xs font-semibold text-emerald-700">Order {line.orderNumber} placed ✓</p>}
            </Bubble>
            {line.products.length > 0 && (
              <div className="flex gap-3 overflow-x-auto pb-1">
                {line.products.map((p) => (
                  <ProductCard key={p.id} product={p} disabled={busy} onOrder={() => send(`I want to order: ${p.title}`)} />
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <Bubble mine={false}>
            <span className="text-zinc-400">typing…</span>
          </Bubble>
        )}
        <div ref={bottom} />
      </div>

      {error && (
        <p className="px-4 pb-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="flex items-center gap-2 border-t border-zinc-200 bg-white p-3"
      >
        <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-xl hover:bg-zinc-100" aria-label="Send a photo">
          📷
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy || recording}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) send(draft, f);
              e.target.value = '';
            }}
          />
        </label>
        <button
          type="button"
          onClick={toggleRecording}
          disabled={busy && !recording}
          aria-label={recording ? 'Stop and send voice note' : 'Record a voice note'}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl disabled:opacity-50 ${recording ? 'animate-pulse bg-red-600 text-white' : 'hover:bg-zinc-100'}`}
        >
          {recording ? '■' : '🎤'}
        </button>
        <input
          className="min-w-0 flex-1 rounded-full border border-zinc-300 px-4 py-2 text-[15px] focus:border-zinc-900 focus:outline-none"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={recording ? 'Recording… tap ■ to send' : 'Message'}
          disabled={recording}
          maxLength={2000}
          aria-label="Message"
        />
        <button className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

function Bubble({ mine, children }: { mine: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed ${
          mine ? 'rounded-br-sm bg-zinc-900 text-white' : 'rounded-bl-sm border border-zinc-200 bg-white text-zinc-900'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function ProductCard({ product: p, onOrder, disabled }: { product: ChatProduct; onOrder: () => void; disabled: boolean }) {
  return (
    <div className="w-44 shrink-0 overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div className="aspect-square bg-zinc-100">
        {p.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.imageUrl} alt={p.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-400">No photo</div>
        )}
      </div>
      <div className="space-y-1 p-2.5 text-sm">
        <p className="line-clamp-2 font-medium leading-snug">{p.title}</p>
        <p className="font-semibold">
          {taka(p.price)}
          {p.regularPrice != null && <span className="ml-1 text-xs font-normal text-zinc-400 line-through">{taka(p.regularPrice)}</span>}
        </p>
        <p className={`text-xs ${p.stock > 0 ? 'text-zinc-500' : 'text-red-600'}`}>
          {p.stock <= 0 ? 'Out of stock' : p.stock <= 3 ? `Only ${p.stock} left` : 'In stock'}
        </p>
        {p.stock > 0 && (
          <button type="button" onClick={onOrder} disabled={disabled} className="mt-1 w-full rounded-lg bg-zinc-900 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            Order this
          </button>
        )}
      </div>
    </div>
  );
}

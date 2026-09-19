'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { mediaLabel, taka, type ChatLine, type ChatProduct } from '@/lib/chat';
import { CheckIcon, CloseIcon, InfoIcon, MicIcon, PhotoIcon, SendIcon } from '@/components/icons';
import { POLICY_FIELDS, policyChips, type ShopPolicies } from '@/lib/policies';
import { shrinkImage } from '@/lib/shrink-image';

const MAX_RECORD_MS = 60_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const POLL_MS = 4000;
const METER_MS = 100;
const LEVEL_BARS = 16;
// crypto.randomUUID only exists on https/localhost; phones testing over the LAN use plain http.
const tempId = () => `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

type ChatClientProps = {
  slug: string;
  shopName: string;
  logoUrl?: string | null;
  aiActive: boolean;
  policies: ShopPolicies;
  initial: ChatLine[];
  since: string | null;
};

export function ChatClient({ slug, shopName, logoUrl, aiActive, policies, initial, since }: ChatClientProps) {
  const [lines, setLines] = useState(initial);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [showPolicies, setShowPolicies] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(LEVEL_BARS).fill(0));
  const recorder = useRef<MediaRecorder | null>(null);
  // Set before stop() so the recorder's own onstop knows whether this was a send or a cancel.
  const discard = useRef(false);
  const meter = useRef<{ ctx: AudioContext; analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> } | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const cursor = useRef(since);

  const chips = policyChips(policies);

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

  // Leaving the page mid-recording must not leave the microphone open.
  useEffect(() => {
    return () => {
      if (ticker.current) clearInterval(ticker.current);
      void meter.current?.ctx.close();
      discard.current = true;
      recorder.current?.stop();
    };
  }, []);

  async function send(text: string, photoOrVoice?: File) {
    const clean = text.trim();
    if (busy || (!clean && !photoOrVoice)) return;
    const file = photoOrVoice?.type.startsWith('image/') ? await shrinkImage(photoOrVoice) : photoOrVoice;
    if (file && file.size > MAX_FILE_BYTES) return setError('File is too large (max 5 MB).');

    const kind = file ? (file.type.startsWith('audio/') ? 'audio' : 'image') : 'text';
    const localUrl = file ? URL.createObjectURL(file) : undefined;
    setLines((l) => [...l, { id: tempId(), from: 'customer', kind, text: clean, products: [], orderNumber: null, mediaPath: null, mediaNote: '', localUrl }]);
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
          { id: tempId(), from: 'bot', kind: 'text', text: 'Dhonnobad! Amader shop team ekhane ektu porei reply debe.', products: [], orderNumber: null, mediaPath: null, mediaNote: '' },
        ]);
    } catch {
      setError('No connection. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function endRecording(keep: boolean) {
    discard.current = !keep;
    recorder.current?.stop();
  }

  async function startRecording() {
    if (recorder.current) return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setError('Allow microphone access to send a voice note.');
    }

    const type = AUDIO_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const chunks: Blob[] = [];
    let rec: MediaRecorder;

    try {
      rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      return setError('Voice notes do not work in this browser. Please type your message.');
    }

    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (ticker.current) clearInterval(ticker.current);
      ticker.current = null;
      void meter.current?.ctx.close();
      meter.current = null;
      recorder.current = null;
      setRecording(false);
      setElapsed(0);
      setLevels(Array(LEVEL_BARS).fill(0));

      const blob = new Blob(chunks, { type: rec.mimeType });
      if (!discard.current && blob.size > 0) send('', new File([blob], 'voice-note', { type: rec.mimeType }));
    };

    discard.current = false;
    // A browser can accept the mime type and still refuse to start. Unhandled, that leaves the customer
    // tapping a microphone button that does nothing.
    try {
      rec.start();
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      return setError('Could not start recording. Please type your message.');
    }

    recorder.current = rec;
    setRecording(true);
    setError('');

    // The bars are the real microphone level, not an animation: a muted or dead mic looks flat, which is
    // the one thing a customer needs to know before they send.
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      meter.current = { ctx, analyser, data: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)) };
    } catch {
      meter.current = null; // No Web Audio: the timer and the cancel still work.
    }

    const startedAt = Date.now();
    ticker.current = setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsed(ms);

      const m = meter.current;
      if (m) {
        m.analyser.getByteTimeDomainData(m.data);
        let peak = 0;
        for (const sample of m.data) peak = Math.max(peak, Math.abs(sample - 128));
        setLevels((l) => [...l.slice(1), Math.min(1, peak / 70)]);
      }

      if (ms >= MAX_RECORD_MS) endRecording(true);
    }, METER_MS);
  }

  return (
    <div className="mx-auto flex h-dvh max-w-2xl flex-col bg-background">
      <header className="border-b border-line bg-surface px-4 pb-2.5 pt-3">
        <div className="flex items-center gap-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-full border border-line object-cover" />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
              {shopName.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{shopName}</p>
            {/* Honest about who is on the other end: the AI really does answer at once, and when the shop
                has paused it, saying so beats a promise nobody is keeping. */}
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
              {aiActive && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
              {aiActive ? 'Shathe shathe reply · Bangla, Banglish or English' : 'Shop team ekhane reply debe'}
            </p>
          </div>
          {Object.keys(policies).length > 0 && (
            <button
              type="button"
              onClick={() => setShowPolicies((v) => !v)}
              aria-expanded={showPolicies}
              aria-label="Shop information"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-zinc-500 hover:bg-content2"
            >
              <InfoIcon />
            </button>
          )}
        </div>

        {chips.length > 0 && (
          <div className="mt-2.5 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {chips.map((chip, i) => (
              <span
                key={chip.key}
                className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${
                  i === 0 ? 'bg-accent-soft text-accent-strong' : 'bg-content2 text-zinc-600'
                }`}
              >
                {chip.text}
              </span>
            ))}
          </div>
        )}

        {showPolicies && (
          <dl className="mt-2.5 space-y-1.5 rounded-control bg-content2 p-3 text-xs">
            {POLICY_FIELDS.filter((field) => policies[field.key]).map((field) => (
              <div key={field.key} className="flex gap-3">
                <dt className="w-32 shrink-0 text-zinc-500">{field.label}</dt>
                <dd className="min-w-0 flex-1">{policies[field.key]}</dd>
              </div>
            ))}
          </dl>
        )}
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {lines.length === 0 && (
          <>
            <Bubble mine={false}>
              <p>Assalamu alaikum! Ki khujchen?</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-zinc-500">
                Likhun, <MicIcon size={15} className="inline-block" /> voice note pathan, ba
                <PhotoIcon size={15} className="inline-block" /> chobi din.
              </p>
            </Bubble>

            {/* Sending a photo is the thing this shop's AI does that a Facebook comment cannot, so it is
                offered before anyone has to think of it. The label opens the composer's own file input. */}
            <div className="space-y-2 pt-1">
              <label
                htmlFor="chat-photo"
                className="flex min-h-12 cursor-pointer items-center gap-2.5 rounded-control border border-line bg-surface px-4 text-[15px] transition-colors duration-150 hover:bg-content2"
              >
                <PhotoIcon size={18} className="shrink-0 text-accent" />
                Chobi ache? Pathan, khuje dibo
              </label>
              <div className="flex gap-2">
                {['Notun ki ache?', 'Ki ki ache dekhan'].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => send(prompt)}
                    disabled={busy}
                    className="min-h-11 flex-1 rounded-control border border-line bg-surface px-3 text-sm transition-colors duration-150 hover:bg-content2 disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        {lines.map((line) => (
          <div key={line.id} className="space-y-2">
            <Bubble mine={line.from === 'customer'}>
              {line.from === 'agent' && <p className="mb-0.5 text-xs font-semibold text-accent-strong">Team member</p>}
              {line.localUrl && line.kind === 'image' && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={line.localUrl} alt="Your photo" className="mb-1 max-h-48 rounded-chip" />
              )}
              {line.localUrl && line.kind === 'audio' && <audio controls src={line.localUrl} className="max-w-full" />}
              {!line.localUrl && line.kind !== 'text' && (
                <p className="flex items-center gap-1.5 opacity-70">
                  {line.kind === 'audio' ? <MicIcon size={15} /> : <PhotoIcon size={15} />}
                  {mediaLabel(line.kind)}
                </p>
              )}
              {line.text && <p className="whitespace-pre-wrap">{line.text}</p>}
              {line.orderNumber && (
                <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold">
                  <CheckIcon size={14} />
                  Order {line.orderNumber} placed
                </p>
              )}
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
        <p className="px-4 pb-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="border-t border-line bg-surface p-3">
        {recording ? (
          <div className="flex items-center gap-2 rounded-control bg-danger-soft py-1.5 pl-3.5 pr-1.5">
            <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-danger" />
            <span className="shrink-0 text-sm font-semibold tabular-nums text-danger-strong">{clock(elapsed)}</span>
            <div className="flex h-6 min-w-0 flex-1 items-center gap-[3px] overflow-hidden" aria-hidden="true">
              {levels.map((level, i) => (
                <span
                  key={i}
                  className="w-[3px] shrink-0 rounded-full bg-danger transition-[height] duration-100 ease-out"
                  style={{ height: `${Math.round(Math.max(0.14, level) * 100)}%` }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => endRecording(false)}
              aria-label="Cancel recording"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-danger-strong hover:bg-danger/10"
            >
              <CloseIcon size={19} />
            </button>
            <button
              type="button"
              onClick={() => endRecording(true)}
              aria-label="Send voice note"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-accent text-accent-foreground transition-colors duration-150 hover:bg-accent-strong"
            >
              <SendIcon size={19} />
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
            className="flex items-center gap-2"
          >
            <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-control border border-line text-zinc-600 hover:bg-content2" aria-label="Send a photo">
              <PhotoIcon />
              <input
                id="chat-photo"
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) send(draft, f);
                  e.target.value = '';
                }}
              />
            </label>
            <input
              className="min-h-11 min-w-0 flex-1 rounded-control border border-line px-4 text-[15px] transition-colors duration-150 focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Likhun…"
              maxLength={2000}
              aria-label="Message"
            />
            {/* One button, two jobs: it sends what is typed, and records when nothing is. */}
            {draft.trim() ? (
              <button
                type="submit"
                aria-label="Send message"
                disabled={busy}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-accent text-accent-foreground transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
              >
                <SendIcon size={21} />
              </button>
            ) : (
              <button
                type="button"
                onClick={startRecording}
                aria-label="Record a voice note"
                disabled={busy}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-accent text-accent-foreground transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
              >
                <MicIcon size={21} />
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

function Bubble({ mine, children }: { mine: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-card px-3.5 py-2 text-[15px] leading-relaxed ${
          mine ? 'rounded-br-sm bg-accent text-accent-foreground' : 'rounded-bl-sm border border-line bg-surface text-foreground'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function ProductCard({ product: p, onOrder, disabled }: { product: ChatProduct; onOrder: () => void; disabled: boolean }) {
  return (
    <div className="w-44 shrink-0 overflow-hidden rounded-card border border-line bg-surface">
      <div className="aspect-square bg-content2">
        {p.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.imageUrl} alt={p.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-400">No photo</div>
        )}
      </div>
      <div className="space-y-1 p-2.5 text-sm">
        <p className="line-clamp-2 font-medium leading-snug">{p.title}</p>
        <p className="font-semibold tabular-nums">
          {taka(p.price)}
          {p.regularPrice != null && <span className="ml-1 text-xs font-normal text-zinc-400 line-through">{taka(p.regularPrice)}</span>}
        </p>
        <p className={`text-xs ${p.stock > 0 ? 'text-zinc-500' : 'text-danger'}`}>
          {p.stock <= 0 ? 'Out of stock' : p.stock <= 3 ? `Only ${p.stock} left` : 'In stock'}
        </p>
        {p.stock > 0 && (
          <button type="button" onClick={onOrder} disabled={disabled} className="mt-1 min-h-9 w-full rounded-chip bg-accent text-xs font-semibold text-accent-foreground transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50">
            Order this
          </button>
        )}
      </div>
    </div>
  );
}

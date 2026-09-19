'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createClient } from '@/lib/supabase/client';
import { BellIcon } from '@/components/icons';

// A sound and a system notification when an order arrives or a customer needs a person, while the dashboard is
// open in any tab — including in the background, on a counter or a phone. Off until the merchant turns it on,
// because browsers only allow sound and notifications after a tap.
// ponytail: open-tab only. Alerts with the dashboard closed need Web Push or Telegram (P0 #2).

const STORAGE_KEY = 'cn_alerts';

type Alert = { title: string; body: string; href: string };

// The on/off choice lives in this browser. When storage is blocked it lives in memory for this visit instead.
let memory = false;
const readOn = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return memory;
  }
};
const writeOn = (value: boolean) => {
  memory = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off');
  } catch {
    /* Not remembered across visits; it still works now. */
  }
  window.dispatchEvent(new Event(STORAGE_KEY));
};
const subscribe = (onChange: () => void) => {
  window.addEventListener('storage', onChange);
  window.addEventListener(STORAGE_KEY, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(STORAGE_KEY, onChange);
  };
};

function chime(ctx: AudioContext) {
  // Two short rising tones: noticeable across a shop floor, not a siren.
  [880, 1320].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + i * 0.18;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.17);
  });
}

export function ShopAlerts({ tenantId }: { tenantId: string }) {
  // Off on the server, then whatever this browser chose.
  const on = useSyncExternalStore(subscribe, readOn, () => false);
  const audio = useRef<AudioContext | null>(null);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (!on) return;
    const supabase = createClient();
    const baseTitle = document.title;

    const fire = (key: string, alert: Alert) => {
      if (seen.current.has(key)) return;
      seen.current.add(key);
      if (audio.current) chime(audio.current);
      if (document.hidden) document.title = `(!) ${baseTitle}`;
      if ('Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(alert.title, { body: alert.body, tag: key });
        n.onclick = () => {
          window.focus();
          window.location.href = alert.href;
        };
      }
    };
    const onFocus = () => (document.title = baseTitle);
    window.addEventListener('focus', onFocus);
    // After a reload the browser keeps sound suspended until the next tap anywhere on the page.
    audio.current ??= new AudioContext();
    const unlock = () => void audio.current?.resume();
    window.addEventListener('pointerdown', unlock, { once: true });

    // RLS decides what arrives: this shop's rows only.
    const channel = supabase
      .channel(`alerts-${tenantId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` }, ({ new: o }) =>
        fire(`order:${o.id}`, { title: 'New order', body: `${o.order_number} · ৳${Number(o.total_bdt).toLocaleString()}`, href: '/dashboard/orders?f=draft' }),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `tenant_id=eq.${tenantId}` }, ({ new: c }) => {
        // Keyed by the hand-off time, so the same chat asking again later alerts again, but not on every message.
        if (c.needs_human) fire(`needs:${c.id}:${c.handoff_at}`, { title: 'A customer needs you', body: c.handoff_reason || 'Open Chats to reply', href: `/dashboard/chats?c=${c.id}` });
      })
      .subscribe();

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pointerdown', unlock);
      document.title = baseTitle;
      supabase.removeChannel(channel);
    };
  }, [on, tenantId]);

  async function toggle() {
    const next = !on;
    if (next) {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      chime(audio.current); // what it will sound like, and proof the sound works
      if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    }
    writeOn(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      title={on ? 'Alerts on: a sound and a notification for new orders and customers who need you' : 'Turn on alerts for new orders and customers who need you'}
      className={`relative flex h-10 w-10 items-center justify-center rounded-control transition-colors duration-150 hover:bg-content2 ${on ? 'text-accent' : 'text-zinc-400'}`}
    >
      <BellIcon size={19} />
      {!on && <span className="absolute left-2 right-2 top-1/2 h-[1.5px] -rotate-45 bg-current" aria-hidden="true" />}
      <span className="sr-only">{on ? 'Alerts on' : 'Alerts off'}</span>
    </button>
  );
}

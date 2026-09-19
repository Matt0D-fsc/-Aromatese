import { nextReset, usageLevel } from '@/lib/usage';
import { t, type Lang } from '@/lib/i18n';

const resetDate = (lang: Lang) =>
  new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'long', timeZone: 'Asia/Dhaka' }).format(nextReset());

// Shown on every dashboard page once the shop is near or past its limit: an AI that has quietly stopped
// replying is the worst thing a merchant can find out from a customer.
export function UsageBanner({ used, limit, lang }: { used: number; limit: number; lang: Lang }) {
  const level = usageLevel(used, limit);
  if (level === 'ok') return null;
  const text = t(lang, level === 'out' ? 'usage.out' : 'usage.warn')
    .replace('{pct}', String(Math.floor((used / Math.max(limit, 1)) * 100)))
    .replace('{limit}', limit.toLocaleString())
    .replace('{date}', resetDate(lang));
  return (
    <div
      role={level === 'out' ? 'alert' : 'status'}
      className={`border-b px-4 py-3 text-center text-sm ${level === 'out' ? 'border-danger/25 bg-danger-soft text-danger-strong' : 'border-warning/30 bg-warning-soft text-warning-strong'}`}
    >
      {text}
    </div>
  );
}

export function UsageMeter({ used, limit, lang }: { used: number; limit: number; lang: Lang }) {
  const level = usageLevel(used, limit);
  const pct = Math.min(100, (used / Math.max(limit, 1)) * 100);
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{t(lang, 'usage.title')}</span>
        <span className="tabular-nums text-zinc-500">
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-content2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        aria-label={t(lang, 'usage.title')}
      >
        <div className={`h-full rounded-full ${level === 'out' ? 'bg-danger' : level === 'warn' ? 'bg-warning' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-zinc-500">{t(lang, 'usage.resets').replace('{date}', resetDate(lang))}</p>
    </div>
  );
}

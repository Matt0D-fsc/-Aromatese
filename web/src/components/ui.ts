// Shared Tailwind class strings. Plain strings, not components: nothing here needs logic.
// Colours come from the semantic tokens in globals.css, so light and dark are the same class list, and
// every control clears 44px — these are used on phones, one-handed.

export const input =
  'w-full rounded-control border border-line bg-surface px-3.5 py-2.5 text-sm text-foreground placeholder:text-zinc-400 transition-colors duration-150 focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15 disabled:bg-content2 disabled:text-zinc-400';

export const label = 'mb-1.5 block text-sm font-medium text-zinc-600';
export const hint = 'mt-1.5 text-xs text-zinc-500';

const button =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-sm font-semibold transition-[background-color,border-color,color,box-shadow] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50';

export const btn = `${button} border border-transparent bg-accent text-accent-foreground hover:bg-accent-strong`;
export const btnGhost = `${button} border border-line bg-surface text-foreground hover:bg-content2`;
export const btnDanger = `${button} border border-danger/25 bg-surface text-danger hover:bg-danger-soft`;

export const card = 'rounded-card border border-line bg-surface p-6 shadow-raised';

export const errorBox = 'rounded-control border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-sm text-danger-strong';
export const noticeBox = 'rounded-control border border-accent/25 bg-accent-soft px-3.5 py-2.5 text-sm text-accent-strong';

export function statusBadge(status: string) {
  const color =
    status === 'active'
      ? 'bg-accent-soft text-accent-strong ring-accent/20'
      : status === 'suspended'
        ? 'bg-danger-soft text-danger-strong ring-danger/20'
        : 'bg-warning-soft text-warning-strong ring-warning/25';
  return `inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${color}`;
}

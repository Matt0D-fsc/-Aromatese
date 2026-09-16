// Shared Tailwind class strings. Plain strings, not components: nothing here needs logic.
export const input =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 disabled:bg-zinc-100';
export const label = 'mb-1 block text-sm font-medium text-zinc-700';
export const hint = 'mt-1 text-xs text-zinc-500';
export const btn =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50';
export const btnGhost =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50';
export const btnDanger =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50';
export const card = 'rounded-xl border border-zinc-200 bg-white p-6 shadow-sm';
export const errorBox = 'rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700';
export const noticeBox = 'rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800';

export function statusBadge(status: string) {
  const color =
    status === 'active'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : status === 'suspended'
        ? 'bg-red-50 text-red-700 ring-red-200'
        : 'bg-amber-50 text-amber-700 ring-amber-200';
  return `inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${color}`;
}

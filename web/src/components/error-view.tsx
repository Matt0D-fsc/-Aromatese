'use client';

// Shared by every error boundary. The message is deliberately vague — the detail is already in the audit
// trail — but the way out is not: retry, or go somewhere that works.
export function ErrorView({ reset, home = '/', homeLabel = 'Back to start' }: { reset?: () => void; home?: string; homeLabel?: string }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
      <p className="text-lg font-medium">Something went wrong</p>
      <p className="mt-1 text-sm text-zinc-500">
        Nothing you typed was lost unless the page says otherwise. Try again, and tell the ChatNab team if it keeps happening.
      </p>
      <div className="mt-6 flex justify-center gap-2">
        {reset && (
          <button
            onClick={reset}
            className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Try again
          </button>
        )}
        <a
          href={home}
          className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100"
        >
          {homeLabel}
        </a>
      </div>
    </div>
  );
}

// A full-page skeleton for route segments that wait on the database.
export function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-48 animate-pulse rounded-lg bg-zinc-200" />
      <div className="h-32 animate-pulse rounded-xl bg-zinc-100" />
      <div className="h-32 animate-pulse rounded-xl bg-zinc-100" />
    </div>
  );
}

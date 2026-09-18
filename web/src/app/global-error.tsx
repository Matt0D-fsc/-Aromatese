'use client';

import { ErrorView } from '@/components/error-view';

// Last resort: only used when the root layout itself fails, so it has to supply its own html and body.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 font-sans">
        <ErrorView reset={reset} />
      </body>
    </html>
  );
}

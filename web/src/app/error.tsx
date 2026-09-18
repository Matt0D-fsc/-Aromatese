'use client';

import { ErrorView } from '@/components/error-view';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <ErrorView reset={reset} />
    </div>
  );
}

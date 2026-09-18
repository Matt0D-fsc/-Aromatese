'use client';

import { ErrorView } from '@/components/error-view';

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <ErrorView reset={reset} home="/admin" homeLabel="Back to admin" />
    </div>
  );
}

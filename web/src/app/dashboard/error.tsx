'use client';

import { ErrorView } from '@/components/error-view';

// Renders inside the dashboard layout, so the merchant keeps their navigation while recovering.
export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView reset={reset} home="/dashboard" homeLabel="Back to products" />;
}

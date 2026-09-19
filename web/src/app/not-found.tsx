import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="mx-auto max-w-lg rounded-card border border-line bg-surface p-8 text-center shadow-sm">
        <p className="text-lg font-medium">Page not found</p>
        <p className="mt-1 text-sm text-zinc-500">The link may be wrong, or the shop may no longer be active.</p>
        <Link href="/" className="mt-6 inline-flex min-h-11 rounded-control bg-accent px-4 text-sm font-semibold text-accent-foreground hover:bg-foreground/90">
          Back to start
        </Link>
      </div>
    </div>
  );
}

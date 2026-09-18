import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="mx-auto max-w-lg rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <p className="text-lg font-medium">Page not found</p>
        <p className="mt-1 text-sm text-zinc-500">The link may be wrong, or the shop may no longer be active.</p>
        <Link href="/" className="mt-6 inline-flex rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700">
          Back to start
        </Link>
      </div>
    </div>
  );
}

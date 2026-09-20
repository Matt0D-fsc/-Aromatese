import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Logo } from '@/components/logo';
import { btn, btnGhost, card } from '@/components/ui';

// The front door. Anyone signed in is sent where they were going, so this page is only ever seen by someone
// who has not logged in — a merchant weighing it up, or a Meta reviewer checking that we are a real product
// before trusting us with other businesses' Pages. Until now they both landed on a bare password box.
//
// No numbers, no logos, no testimonials: nothing here claims anything the product cannot do today.

export default async function Home() {
  const session = await getSession();
  if (session?.isAdmin) redirect('/admin');
  if (session?.tenant) redirect('/dashboard');
  if (session) redirect('/login?error=no-shop');

  const points = [
    {
      title: 'Answers while you sleep',
      body: 'Customers ask at midnight and get a real answer in Bangla, Banglish or English — not "we will get back to you".',
    },
    {
      title: 'Never invents a price',
      body: 'Every price, size and stock count comes from your own catalogue. If you do not sell it, the AI will not promise it.',
    },
    {
      title: 'Knows when to fetch you',
      body: 'Bargaining, a complaint, anything it cannot answer — it flags the chat and tells the customer a person is coming. You take over in one tap.',
    },
  ];

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5">
        <Logo />
        <Link href="/login" className={btnGhost}>
          Merchant login
        </Link>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-20">
        <section className="py-12 sm:py-20">
          <p className="mb-4 inline-flex rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent-strong">
            For Bangladeshi shops selling on chat
          </p>
          <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            An AI salesperson for your shop, on every chat you sell in.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-zinc-600">
            ChatNab answers your customers on Messenger, Instagram and your own chat link. It shows them what you actually have in stock, takes the
            order, and calls you in when a person is needed.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/login" className={btn}>
              Merchant login
            </Link>
            <p className="text-sm text-zinc-500">ChatNab is invite&nbsp;only while we onboard our first shops.</p>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          {points.map((point) => (
            <div key={point.title} className={`${card} space-y-2`}>
              <h2 className="font-semibold">{point.title}</h2>
              <p className="text-sm leading-relaxed text-zinc-600">{point.body}</p>
            </div>
          ))}
        </section>

        <section className="mt-16 sm:mt-24">
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-3">
            {[
              ['Put your products in', 'Photos, prices, sizes and stock. Upload a photo and the AI fills in the rest for you to check.'],
              ['Connect your Page', 'One tap connects Facebook Messenger, and Instagram along with it. Or just share your chat link.'],
              ['Watch the orders come in', 'Every chat and order lands in one inbox. Step in whenever you want; the AI waits for you.'],
            ].map(([title, body], i) => (
              <li key={title} className="space-y-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-strong">
                  {i + 1}
                </span>
                <h3 className="font-semibold">{title}</h3>
                <p className="text-sm leading-relaxed text-zinc-600">{body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-zinc-500">
          <Logo size="sm" />
          <nav className="flex flex-wrap gap-5">
            <Link href="/privacy" className="hover:text-foreground">
              Privacy policy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms of service
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Merchant login
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

import Link from 'next/link';
import { Logo } from '@/components/logo';

// The terms of service Meta asks for alongside the privacy policy, and that merchants are owed before they
// let an AI answer their customers. Written to match what the product actually does and what it does not
// promise. Plain English on purpose: the people agreeing to this run shops, not legal departments.
//
// Have a lawyer read this before launch, and fill in the plan and payment section once pricing is settled.

export const metadata = { title: 'Terms of service · ChatNab' };

const UPDATED = '20 September 2026';
const CONTACT = process.env.NEXT_PUBLIC_PRIVACY_CONTACT;

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2">
    <h2 className="text-lg font-semibold">{title}</h2>
    <div className="space-y-2 text-sm leading-relaxed text-zinc-600">{children}</div>
  </section>
);

export default function Terms() {
  return (
    <main className="mx-auto max-w-2xl space-y-8 px-4 py-12">
      <div>
        <h1 className="text-3xl font-semibold">Terms of service</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated {UPDATED}</p>
      </div>

      <p className="text-sm leading-relaxed text-zinc-600">
        These terms cover shops using ChatNab. By using it you agree to them. If you are agreeing on behalf of a shop, you confirm you are allowed to
        do that.
      </p>

      <Section title="What ChatNab does">
        <p>
          ChatNab answers your customers for you. It replies on your chat link, and on Facebook Messenger and Instagram once you connect those
          accounts. It answers questions about your products, and it can take orders for you to confirm.
        </p>
        <p>It is a tool for your shop. It does not buy, sell or deliver anything itself, and it is not a party to any order your customers place.</p>
      </Section>

      <Section title="Your account">
        <p>
          Accounts are given by invitation. Keep your password to yourself, and keep the list of staff you invite up to date — anything done from your
          shop&rsquo;s account is treated as done by your shop.
        </p>
        <p>Tell us quickly if you think someone else has got in.</p>
      </Section>

      <Section title="What the AI can and cannot promise">
        <p>
          The AI only quotes prices, stock and product details from the catalogue you put in. It is built not to invent them. Even so, it is software
          and it can be wrong, misread a question, or answer awkwardly.
        </p>
        <p>
          You are responsible for what your shop sells and for the orders you confirm. Check an order before you confirm it. You can pause the AI or
          take over any conversation yourself at any time.
        </p>
      </Section>

      <Section title="Your catalogue and your customers">
        <p>
          What you upload stays yours. You give us permission to store it and use it to answer your customers, and nothing else. Do not upload
          anything you do not have the right to use.
        </p>
        <p>
          Your customers&rsquo; messages and details are handled as described in our{' '}
          <Link href="/privacy" className="font-medium text-foreground underline">
            privacy policy
          </Link>
          . You must not use ChatNab to message people who have not messaged you.
        </p>
      </Section>

      <Section title="Fair use">
        <p>Do not use ChatNab to sell anything illegal, to mislead customers about what they are buying, or to send bulk unsolicited messages.</p>
        <p>
          Do not try to break the service, get at another shop&rsquo;s data, or work around the limits on your plan. Connected channels also have to
          follow Facebook and Instagram&rsquo;s own rules; breaking those can get your Page cut off by them, not by us.
        </p>
      </Section>

      <Section title="Plans and limits">
        <p>
          Each shop has a monthly allowance of AI replies. When it runs out the AI stops replying until the month turns, and your staff can still
          answer by hand. Your own messages and your staff&rsquo;s replies never count against it.
        </p>
        <p>Plan prices and payment terms are agreed with you directly.</p>
      </Section>

      <Section title="Stopping">
        <p>
          You can stop using ChatNab whenever you like, and take your customers, catalogue and order history with you as a file before you go. We can
          suspend a shop that breaks these terms, and will say why.
        </p>
      </Section>

      <Section title="Where we stand">
        <p>
          ChatNab is provided as it is. We do not promise it will never be down, and we cannot be responsible for lost sales, lost profit, or what a
          customer does with an answer the AI gave. Nothing here removes rights you have under Bangladeshi law.
        </p>
      </Section>

      <Section title="Changes">
        <p>We may update these terms. If a change matters to you, we will tell you before it takes effect.</p>
      </Section>

      <Section title="Contact">
        {CONTACT ? (
          <p>
            Questions about these terms:{' '}
            <a href={`mailto:${CONTACT}`} className="font-medium text-foreground underline">
              {CONTACT}
            </a>
          </p>
        ) : (
          <p>For questions about these terms, contact us at the address on your invitation.</p>
        )}
      </Section>

      <p className="flex items-center gap-3 border-t border-line pt-6 text-xs text-zinc-500">
        <Link href="/">
          <Logo size="sm" />
        </Link>
        <Link href="/privacy" className="underline">
          Privacy policy
        </Link>
      </p>
    </main>
  );
}

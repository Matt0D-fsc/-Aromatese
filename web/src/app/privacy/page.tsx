import Link from 'next/link';

// The privacy policy Meta asks for at app review, and that customers are owed anyway. Everything here
// describes what the code actually does — if the app changes, this page changes with it.
//
// Set NEXT_PUBLIC_PRIVACY_CONTACT to a real, monitored address before submitting for app review. Meta checks
// that the policy names a way to reach someone.

export const metadata = { title: 'Privacy policy · ChatNab' };

const UPDATED = '20 September 2026';
const CONTACT = process.env.NEXT_PUBLIC_PRIVACY_CONTACT;

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2">
    <h2 className="text-lg font-semibold">{title}</h2>
    <div className="space-y-2 text-sm leading-relaxed text-zinc-600">{children}</div>
  </section>
);

export default function PrivacyPolicy() {
  return (
    <main className="mx-auto max-w-2xl space-y-8 px-4 py-12">
      <div>
        <h1 className="text-3xl font-semibold">Privacy policy</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated {UPDATED}</p>
      </div>

      <p className="text-sm leading-relaxed text-zinc-600">
        ChatNab gives shops an AI assistant that answers their customers and takes orders, over a shop&rsquo;s web chat link, Facebook Messenger and
        Instagram. When you message a shop, the shop decides what to sell you and ChatNab handles the conversation on its behalf. This page explains
        what we hold, why, and how to have it deleted.
      </p>

      <Section title="What we store">
        <ul className="list-disc space-y-1 pl-5">
          <li>The messages you send and the replies you get, including voice notes and photos.</li>
          <li>A written transcript of each voice note and a short description of each photo, so the assistant remembers them later in the chat.</li>
          <li>Your name and phone number, when you give them while placing an order, and the delivery address for that order.</li>
          <li>Which shop you are talking to, and an identifier for you on that channel — a browser cookie on web chat, or the per-Page id Meta gives us on Messenger and Instagram. It is not your Facebook or Instagram profile.</li>
          <li>For web chat only, a one-way scrambled form of your IP address. We keep it to stop flooding, and it cannot be turned back into your IP.</li>
        </ul>
      </Section>

      <Section title="What we do with it">
        <p>
          We use it to answer you, to show you products the shop actually has, and to take and confirm your order. The shop you are messaging can read
          your conversation and reply to you itself.
        </p>
        <p>
          Your messages, voice notes and photos are sent to an AI model so it can understand them and write a reply. Depending on the shop&rsquo;s
          settings this is Google Gemini or a model we run ourselves. We do not sell your data, use it for advertising, or share it with other shops
          on ChatNab.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          Conversations are deleted once they have been inactive for a set period. Records of orders you placed are kept longer, because shops need
          them for their own accounts and tax rules.
        </p>
      </Section>

      <Section title="Deleting your data">
        <p>You can have everything deleted, at any time, in two ways:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Ask the shop you messaged. Their staff can delete your chats and your details from their inbox.</li>
          <li>
            On Messenger or Instagram, open your Facebook or Instagram settings, find ChatNab under Apps and Websites, and remove it. Choosing to
            delete your data there sends the request straight to us, and you get a confirmation code and a page showing that it is done.
          </li>
        </ul>
        <p>
          Deleting removes your messages, voice notes, photos, name and phone number. A shop keeps the record that an order happened, without your
          name, phone number or address on it.
        </p>
      </Section>

      <Section title="Where it is stored">
        <p>
          Conversations and orders are held in a managed Postgres database, and voice notes and photos in private storage that is not publicly
          readable. Each shop can only reach its own data.
        </p>
      </Section>

      <Section title="Children">
        <p>ChatNab is meant for shops and their adult customers. It is not directed at children.</p>
      </Section>

      <Section title="Contact">
        {CONTACT ? (
          <p>
            Questions about your data:{' '}
            <a href={`mailto:${CONTACT}`} className="font-medium text-foreground underline">
              {CONTACT}
            </a>
          </p>
        ) : (
          <p>For questions about your data, contact the shop you messaged — they can reach us on your behalf.</p>
        )}
      </Section>

      <p className="border-t border-line pt-6 text-xs text-zinc-500">
        <Link href="/" className="underline">
          ChatNab
        </Link>
      </p>
    </main>
  );
}

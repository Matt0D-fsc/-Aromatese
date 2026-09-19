import type { Metadata } from 'next';
import { Instrument_Sans, Anek_Bangla } from 'next/font/google';
import { getTheme } from '@/lib/theme';
import './globals.css';

// Two faces, one voice. Until now the app loaded a Latin-only font, so every Bengali character fell back
// to whatever the device happened to have — Nirmala UI on Windows, something different on each Android.
// Anek Bangla sits second in the stack in globals.css: a font renders only the glyphs it owns, so Bengali
// falls through to it by itself.
const instrument = Instrument_Sans({
  variable: '--font-instrument',
  subsets: ['latin'],
  display: 'swap',
});

const anekBangla = Anek_Bangla({
  variable: '--font-anek-bangla',
  subsets: ['bengali', 'latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ChatNab',
  description: 'AI sales agent for WhatsApp, Messenger and Instagram shops',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read on the server, so the class is in the first byte of HTML and the page never flashes the other theme.
  const theme = await getTheme();

  return (
    <html lang="en" className={`${theme} ${instrument.variable} ${anekBangla.variable} h-full antialiased`}>
      <body className="min-h-full bg-background font-sans text-foreground">{children}</body>
    </html>
  );
}

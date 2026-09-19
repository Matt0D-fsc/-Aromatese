import { cookies } from 'next/headers';
import { LANG_COOKIE, type Lang } from '@/lib/i18n';

// Kept apart from lib/i18n.ts so that module stays free of next/headers. A client component that only needs
// LANGS or the cookie name must not drag a server-only import across the boundary with it.
export async function getLang(): Promise<Lang> {
  return (await cookies()).get(LANG_COOKIE)?.value === 'bn' ? 'bn' : 'en';
}

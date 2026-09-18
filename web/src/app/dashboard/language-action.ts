'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { LANG_COOKIE, type Lang } from '@/lib/i18n';

// A preference, not a secret: readable by the browser is fine, and it should survive a year of visits.
export async function setLanguage(lang: Lang) {
  (await cookies()).set(LANG_COOKIE, lang === 'bn' ? 'bn' : 'en', {
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath('/dashboard', 'layout');
}

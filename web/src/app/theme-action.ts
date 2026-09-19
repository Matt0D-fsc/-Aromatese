'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { THEME_COOKIE, type Theme } from '@/lib/theme';

// A preference, not a secret. It lives a year and applies to every surface, so a merchant who picks dark
// sees their own chat link in dark too.
export async function setTheme(theme: Theme) {
  (await cookies()).set(THEME_COOKIE, theme === 'dark' ? 'dark' : 'light', {
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath('/', 'layout');
}

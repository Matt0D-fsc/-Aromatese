import { cookies } from 'next/headers';

// Light or dark, chosen by the person and remembered in a cookie the server reads — the same shape as the
// language preference, so the class is on <html> in the first byte of HTML and nothing flashes.
export const THEME_COOKIE = 'cn_theme';
export type Theme = 'light' | 'dark';

export async function getTheme(): Promise<Theme> {
  return (await cookies()).get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
}

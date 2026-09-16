import { headers } from 'next/headers';

export async function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || (await headers()).get('origin') || 'http://localhost:3000';
}

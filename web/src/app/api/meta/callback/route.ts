import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { auditError } from '@/lib/audit';
import { META_STATE_COOKIE, META_TOKEN_COOKIE, META_TOKEN_TTL } from '@/lib/channels';
import { exchangeCode } from '@/lib/meta';
import { siteUrl } from '@/lib/site';

// Where Meta sends the merchant back after they grant access. It swaps the one-time code for a long-lived
// token, parks it in an httpOnly cookie and sends them on to pick which Page to connect.
//
// The token is never put in the URL: a query string ends up in browser history, in the referrer of the next
// request, and in every proxy log on the way.

export const metaRedirectUri = async () => `${await siteUrl()}/api/meta/callback`;

export async function GET(request: Request) {
  // Whoever comes back must be the merchant who left. Without this the callback is an open endpoint that
  // would attach someone else's Facebook Page to whichever shop happened to be signed in.
  const { tenant, user } = await requireMerchant();

  const params = new URL(request.url).searchParams;
  const jar = await cookies();
  const state = jar.get(META_STATE_COOKIE)?.value;
  jar.delete(META_STATE_COOKIE);

  // They pressed Cancel on Facebook, or declined a permission.
  if (params.get('error')) redirect('/dashboard/channels?error=cancelled');
  // Either the trip did not start here, or it started in a different browser: not something to push through.
  if (!state || state !== params.get('state')) redirect('/dashboard/channels?error=expired');

  const code = params.get('code');
  if (!code) redirect('/dashboard/channels?error=expired');

  try {
    const token = await exchangeCode(code, await metaRedirectUri());
    jar.set(META_TOKEN_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: META_TOKEN_TTL,
    });
  } catch (err) {
    await auditError('meta.connect_exchange', err, { actorId: user.id, tenantId: tenant.id });
    redirect('/dashboard/channels?error=exchange');
  }

  redirect('/dashboard/channels');
}

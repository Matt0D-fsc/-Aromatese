import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';

export default async function Home() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.isAdmin) redirect('/admin');
  if (session.tenant) redirect('/dashboard');
  redirect('/login?error=no-shop');
}

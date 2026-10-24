import type { Metadata } from 'next';
import { AuthAbout } from '../../features/auth/auth-about';
import { authReturnPath } from '../../features/auth/return-path';
import '../../features/auth/auth-entry.css';

export const metadata: Metadata = { title: 'Sobre nosotros | KeepGym' };
export default async function AboutPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const params = await searchParams;
  const destination = authReturnPath(
    typeof params.returnTo === 'string' ? params.returnTo : null,
  );
  return (
    <AuthAbout
      loginHref={'/login?' + new URLSearchParams({ returnTo: destination })}
    />
  );
}

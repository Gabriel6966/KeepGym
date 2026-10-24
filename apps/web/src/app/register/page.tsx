import { Suspense } from 'react';
import type { Metadata } from 'next';
import { RegisterClient } from '../../features/auth/register-client';
import { AuthLoading } from '../../features/auth/auth-page-shell';
import '../../features/auth/auth-entry.css';

export const metadata: Metadata = { title: 'Crear cuenta | KeepGym' };
export default function RegisterPage() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <RegisterClient />
    </Suspense>
  );
}

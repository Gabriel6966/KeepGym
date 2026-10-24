import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/features/auth/login-form';
import { AuthLoading } from '@/features/auth/auth-page-shell';
import '@/features/auth/auth-entry.css';

export const metadata: Metadata = { title: 'Accede a KeepGym' };
export default function LoginPage() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <LoginForm />
    </Suspense>
  );
}

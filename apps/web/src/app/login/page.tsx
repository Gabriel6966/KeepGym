import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/features/auth/login-form';

export const metadata: Metadata = { title: 'Sign in | Gym App' };
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main
          id="main-content"
          className="flex min-h-screen items-center justify-center"
        >
          <p role="status">Loading sign in...</p>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

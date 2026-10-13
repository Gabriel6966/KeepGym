import { Suspense } from 'react';
import type { Metadata } from 'next';
import { RegisterClient } from '../../features/auth/register-client';

export const metadata: Metadata = { title: 'Create account · Gym App' };
export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <main id="main-content" className="p-8" role="status">
          Checking session...
        </main>
      }
    >
      <RegisterClient />
    </Suspense>
  );
}

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DashboardClient } from '@/features/dashboard/dashboard-client';
import { DashboardSkeleton } from '@/features/dashboard/dashboard.ui';

export const metadata: Metadata = { title: 'Dashboard | Gym App' };
export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <main id="main-content" className="mx-auto max-w-7xl px-4 py-12">
          <DashboardSkeleton />
        </main>
      }
    >
      <DashboardClient />
    </Suspense>
  );
}

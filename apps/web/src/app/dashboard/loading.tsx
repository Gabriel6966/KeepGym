import { DashboardSkeleton } from '@/features/dashboard/dashboard.ui';

export default function Loading() {
  return (
    <main id="main-content" className="mx-auto max-w-7xl px-4 py-12">
      <DashboardSkeleton />
    </main>
  );
}

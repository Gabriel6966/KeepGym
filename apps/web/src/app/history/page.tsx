import type { Metadata } from 'next';
import { Suspense } from 'react';
import { HistoryList } from '@/features/history/history-list';
import { WorkoutLoading } from '@/features/workout/workout.ui';

export const metadata: Metadata = { title: 'History | Gym App' };
export default function HistoryPage() {
  return (
    <Suspense
      fallback={
        <main id="main-content" className="mx-auto max-w-4xl px-4 py-8">
          <WorkoutLoading label="Loading workout history..." />
        </main>
      }
    >
      <HistoryList />
    </Suspense>
  );
}

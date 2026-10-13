import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ProgressSelector } from '../../features/progress/progress-selector';
import { WorkoutLoading } from '../../features/workout/workout.ui';
export const metadata: Metadata = { title: 'Exercise Progress · Gym App' };
export default function ProgressPage() {
  return (
    <Suspense
      fallback={
        <main id="main-content" className="p-8">
          <WorkoutLoading label="Loading exercises..." />
        </main>
      }
    >
      <ProgressSelector />
    </Suspense>
  );
}

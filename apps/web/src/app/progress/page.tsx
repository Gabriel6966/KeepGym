import { Suspense } from 'react';
import type { Metadata } from 'next';
import { TrainingProgressOverview } from '../../features/progress/training-overview';
import { WorkoutLoading } from '../../features/workout/workout.ui';
export const metadata: Metadata = { title: 'Training Progress · Gym App' };
export default function ProgressPage() {
  return (
    <Suspense
      fallback={
        <main id="main-content" className="p-8">
          <WorkoutLoading label="Loading training progress..." />
        </main>
      }
    >
      <TrainingProgressOverview />
    </Suspense>
  );
}

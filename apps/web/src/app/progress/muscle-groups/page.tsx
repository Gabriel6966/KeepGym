import { Suspense } from 'react';
import type { Metadata } from 'next';
import { MuscleGroupProgress } from '../../../features/progress/muscle-progress';
import { WorkoutLoading } from '../../../features/workout/workout.ui';
export const metadata: Metadata = { title: 'Muscle Group Progress · Gym App' };
export default function MuscleProgressPage() {
  return (
    <Suspense
      fallback={
        <main id="main-content" className="p-8">
          <WorkoutLoading label="Loading muscle-group progress..." />
        </main>
      }
    >
      <MuscleGroupProgress />
    </Suspense>
  );
}

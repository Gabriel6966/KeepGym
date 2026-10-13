import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ExerciseProgressDetail } from '../../../../features/progress/progress-detail';
import { WorkoutLoading } from '../../../../features/workout/workout.ui';
export const metadata: Metadata = { title: 'Exercise Progress · Gym App' };
export default async function ExerciseProgressPage({
  params,
}: {
  params: Promise<{ exerciseId: string }>;
}) {
  const { exerciseId } = await params;
  return (
    <Suspense
      fallback={
        <main id="main-content" className="p-8">
          <WorkoutLoading label="Loading exercise progress..." />
        </main>
      }
    >
      <ExerciseProgressDetail exerciseId={exerciseId} />
    </Suspense>
  );
}

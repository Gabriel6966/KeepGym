import { WorkoutLoading } from '@/features/workout/workout.ui';

export default function LoadingWorkout() {
  return (
    <main id="main-content" className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Workout</h1>
      <WorkoutLoading />
    </main>
  );
}

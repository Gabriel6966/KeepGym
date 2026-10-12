import { WorkoutLoading } from '@/features/workout/workout.ui';
export default function BodyLoading() {
  return (
    <main id="main-content" className="mx-auto max-w-4xl px-4 py-8">
      <WorkoutLoading label="Loading body measurements..." />
    </main>
  );
}

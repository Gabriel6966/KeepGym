import { WorkoutLoading } from '@/features/workout/workout.ui';

export default function LoadingTemplates() {
  return (
    <main id="main-content" className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-6 text-3xl font-semibold">Templates</h1>
      <WorkoutLoading label="Loading templates..." />
    </main>
  );
}

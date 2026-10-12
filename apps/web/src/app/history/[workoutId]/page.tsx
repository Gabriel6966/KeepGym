import type { Metadata } from 'next';
import { HistoryDetail } from '@/features/history/history-detail';

export const metadata: Metadata = { title: 'Workout history | Gym App' };
export default async function WorkoutHistoryPage({
  params,
}: {
  params: Promise<{ workoutId: string }>;
}) {
  const { workoutId } = await params;
  return <HistoryDetail key={workoutId} workoutId={workoutId} />;
}

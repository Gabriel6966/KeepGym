import type { Metadata } from 'next';
import { WorkoutSessionClient } from '@/features/workout/workout-session';

export const metadata: Metadata = { title: 'Workout session | Gym App' };
export default async function WorkoutSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <WorkoutSessionClient key={sessionId} sessionId={sessionId} />;
}

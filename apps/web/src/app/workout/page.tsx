import type { Metadata } from 'next';
import { TemplatePicker } from '@/features/workout/template-picker';

export const metadata: Metadata = { title: 'Workout | Gym App' };
export default function WorkoutPage() {
  return <TemplatePicker />;
}

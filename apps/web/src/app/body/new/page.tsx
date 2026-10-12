import type { Metadata } from 'next';
import { BodyEditor } from '@/features/body/body-editor';
export const metadata: Metadata = { title: 'Add measurement | Gym App' };
export default function NewMeasurementPage() {
  return <BodyEditor />;
}

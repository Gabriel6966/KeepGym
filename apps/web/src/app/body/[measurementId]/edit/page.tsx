import type { Metadata } from 'next';
import { BodyEditor } from '@/features/body/body-editor';
export const metadata: Metadata = { title: 'Edit measurement | Gym App' };
export default async function EditMeasurementPage({
  params,
}: {
  params: Promise<{ measurementId: string }>;
}) {
  const { measurementId } = await params;
  return <BodyEditor key={measurementId} measurementId={measurementId} />;
}

import type { Metadata } from 'next';
import { BodyList } from '@/features/body/body-list';
export const metadata: Metadata = { title: 'Body | Gym App' };
export default function BodyPage() {
  return <BodyList />;
}

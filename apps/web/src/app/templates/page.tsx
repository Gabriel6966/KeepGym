import type { Metadata } from 'next';
import { TemplatesList } from '@/features/templates/templates-list';

export const metadata: Metadata = { title: 'Templates | Gym App' };
export default function TemplatesPage() {
  return <TemplatesList />;
}

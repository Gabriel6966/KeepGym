import type { Metadata } from 'next';
import { TemplateCreate } from '@/features/templates/template-create';

export const metadata: Metadata = { title: 'Create template | Gym App' };
export default function CreateTemplatePage() {
  return <TemplateCreate />;
}

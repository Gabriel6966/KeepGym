import type { Metadata } from 'next';
import { TemplateDetail } from '@/features/templates/template-detail';

export const metadata: Metadata = { title: 'Template | Gym App' };
export default async function TemplatePage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  return <TemplateDetail key={templateId} templateId={templateId} />;
}

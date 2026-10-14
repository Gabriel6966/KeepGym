import type { Metadata } from 'next';
import { Suspense } from 'react';
import { HistoryCalendar } from '@/features/history/calendar-client';
import { CalendarLoading } from '@/features/history/calendar-content';

export const metadata: Metadata = { title: 'Training calendar | Gym App' };
export default function TrainingCalendarPage() {
  return (
    <Suspense
      fallback={
        <main id="main-content" className="mx-auto max-w-5xl px-4 py-8">
          <CalendarLoading />
        </main>
      }
    >
      <HistoryCalendar />
    </Suspense>
  );
}

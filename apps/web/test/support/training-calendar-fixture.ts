import {
  calendarDates,
  monthBoundaries,
} from '../../src/features/history/calendar-month';
import type { TrainingCalendar } from '../../src/features/history/calendar.types';

export function trainingCalendar(month = '2026-10'): TrainingCalendar {
  const range = monthBoundaries(month);
  return {
    ...range,
    timezone: 'Europe/Madrid',
    days: calendarDates(range.fromDate, range.toDate)!.map((date, index) => ({
      date,
      completedWorkouts:
        index === 0 || index === 1 || index === 2 ? 1 : index === 3 ? 2 : 0,
      completedSets: index === 0 ? 3 : index === 2 ? 2 : 0,
      totalReps: index === 0 ? 21 : index === 2 ? 16 : 0,
      totalVolumeKg: index === 0 ? 1727.25 : 0,
      totalDurationSeconds:
        index === 0
          ? 5400.125
          : index === 1
            ? 3600
            : index === 2
              ? 1800
              : index === 3
                ? 7200
                : 0,
    })),
  };
}

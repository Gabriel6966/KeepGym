import { randomUUID } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client';
import type { TrainingCalendarRepository } from '../../src/training-calendar/training-calendar.repository';
import type {
  DailyActivityRecord,
  PublicActivityDay,
  TrainingCalendarQuery,
} from '../../src/training-calendar/training-calendar.types';
import type { DurationSessionFixture } from './in-memory-training-duration.repository';

export interface CalendarSessionFixture extends DurationSessionFixture {
  exercises: { sets: { loadKg: string; reps: number }[] }[];
}
export const calendarInput = {
  fromDate: '2026-09-28',
  toDate: '2026-10-04',
  timezone: 'Europe/Madrid',
};
export function zeroDay(date: string): PublicActivityDay {
  return {
    date,
    completedWorkouts: 0,
    completedSets: 0,
    totalReps: 0,
    totalVolumeKg: 0,
    totalDurationSeconds: 0,
  };
}
export const expectedCalendar = {
  ...calendarInput,
  days: [
    {
      ...zeroDay('2026-09-28'),
      completedWorkouts: 2,
      completedSets: 2,
      totalReps: 16,
      totalVolumeKg: 1280,
      totalDurationSeconds: 4500,
    },
    zeroDay('2026-09-29'),
    {
      ...zeroDay('2026-09-30'),
      completedWorkouts: 1,
      completedSets: 1,
      totalReps: 7,
      totalVolumeKg: 575.75,
      totalDurationSeconds: 3600.5,
    },
    zeroDay('2026-10-01'),
    zeroDay('2026-10-02'),
    {
      ...zeroDay('2026-10-03'),
      completedWorkouts: 1,
      completedSets: 1,
      totalReps: 10,
      totalDurationSeconds: 1200,
    },
    zeroDay('2026-10-04'),
  ],
};
export function fixtureLocalDate(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}
// Independent fixture oracle. Real SQL and its joins have separate PG tests.
export class InMemoryTrainingCalendarRepository implements Pick<
  TrainingCalendarRepository,
  'findDailyActivity'
> {
  constructor(readonly sessions: CalendarSessionFixture[] = []) {}
  findDailyActivity(
    userId: string,
    query: TrainingCalendarQuery,
  ): Promise<DailyActivityRecord[]> {
    const rows = new Map<string, DailyActivityRecord>();
    for (const session of this.sessions) {
      const date = fixtureLocalDate(session.startedAt, query.timezone);
      if (
        session.userId !== userId ||
        session.status !== 'COMPLETED' ||
        date < query.fromDate ||
        date > query.toDate
      )
        continue;
      const row = rows.get(date) ?? {
        date,
        completedWorkouts: '0',
        completedSets: '0',
        totalReps: '0',
        totalVolumeKg: '0',
        totalDurationSeconds: '0',
        invalidDurationCount: '0',
      };
      row.completedWorkouts = String(Number(row.completedWorkouts) + 1);
      if (session.endedAt === null || session.endedAt < session.startedAt)
        row.invalidDurationCount = String(Number(row.invalidDurationCount) + 1);
      if (session.endedAt)
        row.totalDurationSeconds = new Prisma.Decimal(row.totalDurationSeconds!)
          .plus(
            new Prisma.Decimal(
              session.endedAt.getTime() - session.startedAt.getTime(),
            ).div(1000),
          )
          .toString();
      for (const exercise of session.exercises)
        for (const set of exercise.sets) {
          row.completedSets = String(Number(row.completedSets) + 1);
          row.totalReps = String(Number(row.totalReps) + set.reps);
          row.totalVolumeKg = new Prisma.Decimal(row.totalVolumeKg)
            .plus(new Prisma.Decimal(set.loadKg).mul(set.reps))
            .toString();
        }
      rows.set(date, row);
    }
    return Promise.resolve(
      [...rows.values()].sort((a, b) => a.date.localeCompare(b.date)),
    );
  }
}
export function trainingCalendarFixture() {
  const owner = randomUUID(),
    other = randomUUID(),
    repository = new InMemoryTrainingCalendarRepository();
  function add(
    userId: string,
    start: string,
    seconds: number | null,
    exercises: CalendarSessionFixture['exercises'] = [],
    status: CalendarSessionFixture['status'] = 'COMPLETED',
  ) {
    const startedAt = new Date(start);
    repository.sessions.push({
      userId,
      startedAt,
      endedAt:
        seconds === null
          ? null
          : new Date(startedAt.getTime() + seconds * 1000),
      exercises,
      status,
    });
  }
  const sets = (loadKg: string, reps: number, count = 1) => [
    { sets: Array.from({ length: count }, () => ({ loadKg, reps })) },
  ];
  add(owner, '2026-09-28T08:00:00Z', 2700, sets('80', 8, 2));
  add(owner, '2026-09-28T12:00:00Z', 1800);
  add(owner, '2026-09-30T08:00:00Z', 3600.5, sets('82.25', 7));
  add(owner, '2026-10-01T08:00:00Z', 999999, sets('900', 99), 'CANCELLED');
  add(owner, '2026-10-02T08:00:00Z', null, sets('999', 99), 'IN_PROGRESS');
  add(owner, '2026-10-03T08:00:00Z', 1200, sets('0', 10));
  add(other, '2026-09-28T08:00:00Z', 900000, sets('1000', 100));
  return { owner, other, repository, add, sets };
}

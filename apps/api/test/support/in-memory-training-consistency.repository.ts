import { randomUUID } from 'node:crypto';
import type { TrainingConsistencyRepository } from '../../src/training-consistency/training-consistency.repository';
import type {
  WeeklyActivityRecord,
  WeeklyConsistencyQuery,
} from '../../src/training-consistency/training-consistency.types';
import {
  localMonday,
  type TrendSessionFixture,
} from './in-memory-training-trends.repository';

export const consistencyInput = {
  fromWeekStart: '2026-08-24',
  toWeekStart: '2026-09-28',
  timezone: 'Europe/Madrid',
};
export const expectedConsistency = {
  timezone: 'Europe/Madrid',
  fromWeekStart: '2026-08-24',
  toWeekStart: '2026-09-28',
  totalWeeks: 6,
  completedWorkouts: 7,
  activeDays: 6,
  activeWeeks: 5,
  longestWeeklyStreak: 3,
  endingWeeklyStreak: 3,
};

export class InMemoryTrainingConsistencyRepository implements Pick<
  TrainingConsistencyRepository,
  'findWeeklyActivity'
> {
  constructor(readonly sessions: TrendSessionFixture[] = []) {}
  async findWeeklyActivity(
    userId: string,
    query: WeeklyConsistencyQuery,
  ): Promise<WeeklyActivityRecord[]> {
    const buckets = new Map<string, { workouts: number; days: Set<string> }>();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: query.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    for (const session of this.sessions) {
      if (session.userId !== userId || session.status !== 'COMPLETED') continue;
      const weekStart = localMonday(session.startedAt, query.timezone);
      if (weekStart < query.fromWeekStart || weekStart > query.toWeekStart)
        continue;
      const bucket = buckets.get(weekStart) ?? {
        workouts: 0,
        days: new Set<string>(),
      };
      bucket.workouts++;
      bucket.days.add(formatter.format(session.startedAt));
      buckets.set(weekStart, bucket);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, bucket]) => ({
        weekStart,
        completedWorkouts: String(bucket.workouts),
        activeDays: String(bucket.days.size),
      }));
  }
}
export function trainingConsistencyFixture() {
  const owner = randomUUID();
  const other = randomUUID();
  const sessions: TrendSessionFixture[] = [
    ...[
      '2026-08-24T08:00:00Z',
      '2026-08-24T16:00:00Z',
      '2026-08-26T10:00:00Z',
      '2026-09-01T10:00:00Z',
      '2026-09-14T10:00:00Z',
      '2026-09-23T10:00:00Z',
      '2026-10-02T10:00:00Z',
    ].map((instant): TrendSessionFixture => ({
      userId: owner,
      startedAt: new Date(instant),
      status: 'COMPLETED',
      sets: [],
    })),
    {
      userId: owner,
      startedAt: new Date('2026-09-08T10:00:00Z'),
      status: 'CANCELLED',
      sets: [{ loadKg: '200', reps: 10 }],
    },
    {
      userId: owner,
      startedAt: new Date('2026-09-09T10:00:00Z'),
      status: 'IN_PROGRESS',
      sets: [{ loadKg: '300', reps: 10 }],
    },
    ...[
      '2026-08-24',
      '2026-08-31',
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
    ].map((monday): TrendSessionFixture => ({
      userId: other,
      startedAt: new Date(monday + 'T12:00:00Z'),
      status: 'COMPLETED',
      sets: [],
    })),
  ];
  return {
    owner,
    other,
    repository: new InMemoryTrainingConsistencyRepository(sessions),
  };
}

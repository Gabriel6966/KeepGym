import { randomUUID } from 'node:crypto';
import type { TrainingDurationRepository } from '../../src/training-duration/training-duration.repository';
import type {
  WeeklyDurationRecord,
  WeeklyTrainingDurationQuery,
} from '../../src/training-duration/training-duration.types';
import { localMonday } from './in-memory-training-trends.repository';

export interface DurationSessionFixture {
  userId: string;
  startedAt: Date;
  endedAt: Date | null;
  status: 'COMPLETED' | 'CANCELLED' | 'IN_PROGRESS';
}
export const durationInput = {
  from: '2026-09-07T00:00:00+02:00',
  to: '2026-10-04T23:59:59.999+02:00',
  timezone: 'Europe/Madrid',
};
export const expectedDuration = {
  timezone: 'Europe/Madrid',
  from: '2026-09-06T22:00:00.000Z',
  to: '2026-10-04T21:59:59.999Z',
  summary: {
    completedWorkouts: 4,
    totalDurationSeconds: 16230.5,
    averageDurationSeconds: 4057.625,
  },
  buckets: [
    {
      weekStart: '2026-09-07',
      completedWorkouts: 2,
      totalDurationSeconds: 7200,
      averageDurationSeconds: 3600,
    },
    {
      weekStart: '2026-09-14',
      completedWorkouts: 1,
      totalDurationSeconds: 3600,
      averageDurationSeconds: 3600,
    },
    {
      weekStart: '2026-09-28',
      completedWorkouts: 1,
      totalDurationSeconds: 5430.5,
      averageDurationSeconds: 5430.5,
    },
  ],
};
// Independent small-fixture oracle; actual PostgreSQL is exercised separately.
export class InMemoryTrainingDurationRepository implements Pick<
  TrainingDurationRepository,
  'findWeeklyDurations'
> {
  constructor(readonly sessions: DurationSessionFixture[] = []) {}
  findWeeklyDurations(
    userId: string,
    query: WeeklyTrainingDurationQuery,
  ): Promise<WeeklyDurationRecord[]> {
    const weeks = new Map<
      string,
      { count: number; milliseconds: number; invalid: number }
    >();
    for (const session of this.sessions) {
      if (
        session.userId !== userId ||
        session.status !== 'COMPLETED' ||
        session.startedAt < query.from ||
        session.startedAt > query.to
      )
        continue;
      const week = localMonday(session.startedAt, query.timezone);
      const row = weeks.get(week) ?? { count: 0, milliseconds: 0, invalid: 0 };
      row.count++;
      if (session.endedAt === null || session.endedAt < session.startedAt)
        row.invalid++;
      if (session.endedAt !== null)
        row.milliseconds +=
          session.endedAt.getTime() - session.startedAt.getTime();
      weeks.set(week, row);
    }
    return Promise.resolve(
      [...weeks]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([weekStart, row]) => ({
          weekStart,
          completedWorkouts: String(row.count),
          totalDurationSeconds: String(row.milliseconds / 1000),
          invalidDurationCount: String(row.invalid),
        })),
    );
  }
}
export function trainingDurationFixture() {
  const owner = randomUUID(),
    other = randomUUID();
  const repository = new InMemoryTrainingDurationRepository();
  function add(
    userId: string,
    start: string,
    seconds: number | null,
    status: DurationSessionFixture['status'] = 'COMPLETED',
  ) {
    const startedAt = new Date(start);
    repository.sessions.push({
      userId,
      startedAt,
      endedAt:
        seconds === null
          ? null
          : new Date(startedAt.getTime() + seconds * 1000),
      status,
    });
  }
  add(owner, '2026-09-07T08:00:00Z', 2700);
  add(owner, '2026-09-09T08:00:00Z', 4500);
  add(owner, '2026-09-14T08:00:00Z', 3600);
  add(owner, '2026-09-21T08:00:00Z', 999999, 'CANCELLED');
  add(owner, '2026-09-22T08:00:00Z', null, 'IN_PROGRESS');
  add(owner, '2026-09-28T08:00:00Z', 5430.5);
  add(other, '2026-09-07T08:00:00Z', 900000);
  return { owner, other, repository, add };
}

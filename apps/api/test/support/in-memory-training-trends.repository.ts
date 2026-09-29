import { randomUUID } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client';
import type { TrainingTrendsRepository } from '../../src/training-trends/training-trends.repository';
import type {
  WeeklyTrainingTrendsQuery,
  WeeklyTrainingTrendsRecord,
} from '../../src/training-trends/training-trends.types';

export interface TrendSessionFixture {
  userId: string;
  startedAt: Date;
  status: 'COMPLETED' | 'CANCELLED' | 'IN_PROGRESS';
  sets: { loadKg: string; reps: number }[];
}
// Independent in-memory oracle for HTTP/service tests; real SQL is tested separately.
function localMonday(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: string) =>
    Number(parts.find((entry) => entry.type === type)!.value);
  const date = new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
export class InMemoryTrainingTrendsRepository implements Pick<
  TrainingTrendsRepository,
  'findWeeklyTrends'
> {
  constructor(readonly sessions: TrendSessionFixture[] = []) {}
  findWeeklyTrends(
    userId: string,
    query: WeeklyTrainingTrendsQuery,
  ): Promise<WeeklyTrainingTrendsRecord[]> {
    const buckets = new Map<string, WeeklyTrainingTrendsRecord>();
    for (const session of this.sessions) {
      if (
        session.userId !== userId ||
        session.status !== 'COMPLETED' ||
        session.startedAt < query.from ||
        session.startedAt > query.to
      )
        continue;
      const weekStart = localMonday(session.startedAt, query.timezone);
      const bucket = buckets.get(weekStart) ?? {
        weekStart,
        completedWorkouts: '0',
        completedSets: '0',
        totalReps: '0',
        totalVolumeKg: '0',
      };
      bucket.completedWorkouts = String(Number(bucket.completedWorkouts) + 1);
      bucket.completedSets = String(
        Number(bucket.completedSets) + session.sets.length,
      );
      for (const set of session.sets) {
        bucket.totalReps = String(Number(bucket.totalReps) + set.reps);
        bucket.totalVolumeKg = new Prisma.Decimal(bucket.totalVolumeKg)
          .plus(new Prisma.Decimal(set.loadKg).mul(set.reps))
          .toString();
      }
      buckets.set(weekStart, bucket);
    }
    return Promise.resolve(
      [...buckets.values()].sort((a, b) =>
        a.weekStart.localeCompare(b.weekStart),
      ),
    );
  }
}
export function trainingTrendsFixture() {
  const owner = randomUUID();
  const other = randomUUID();
  const sessions: TrendSessionFixture[] = [
    {
      userId: owner,
      startedAt: new Date('2026-09-14T10:00:00Z'),
      status: 'COMPLETED',
      sets: [
        { loadKg: '80', reps: 8 },
        { loadKg: '80', reps: 8 },
      ],
    },
    {
      userId: owner,
      startedAt: new Date('2026-09-18T10:00:00Z'),
      status: 'COMPLETED',
      sets: [],
    },
    {
      userId: owner,
      startedAt: new Date('2026-09-21T10:00:00Z'),
      status: 'COMPLETED',
      sets: [{ loadKg: '82.25', reps: 7 }],
    },
    {
      userId: owner,
      startedAt: new Date('2026-09-22T10:00:00Z'),
      status: 'CANCELLED',
      sets: [{ loadKg: '200', reps: 10 }],
    },
    {
      userId: owner,
      startedAt: new Date('2026-09-23T10:00:00Z'),
      status: 'IN_PROGRESS',
      sets: [{ loadKg: '250', reps: 10 }],
    },
    {
      userId: other,
      startedAt: new Date('2026-09-21T10:00:00Z'),
      status: 'COMPLETED',
      sets: [{ loadKg: '300', reps: 10 }],
    },
  ];
  return {
    owner,
    other,
    repository: new InMemoryTrainingTrendsRepository(sessions),
  };
}

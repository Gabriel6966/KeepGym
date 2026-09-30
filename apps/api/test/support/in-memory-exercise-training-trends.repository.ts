import { randomUUID } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client';
import type { TrainingTrendsRepository } from '../../src/training-trends/training-trends.repository';
import type {
  ExerciseTrendSnapshot,
  ExerciseWeeklyTrendsData,
  ExerciseWeeklyTrendsRecord,
  WeeklyTrainingTrendsQuery,
} from '../../src/training-trends/training-trends.types';
import {
  localMonday,
  type TrendSessionFixture,
} from './in-memory-training-trends.repository';

export interface ExerciseTrendFixture extends TrendSessionFixture {
  sessionId: string;
  snapshot: ExerciseTrendSnapshot;
}

export class InMemoryExerciseTrainingTrendsRepository implements Pick<
  TrainingTrendsRepository,
  'findExerciseWeeklyTrends'
> {
  constructor(readonly occurrences: ExerciseTrendFixture[]) {}

  findExerciseWeeklyTrends(
    userId: string,
    exerciseId: string,
    query: WeeklyTrainingTrendsQuery,
  ): Promise<ExerciseWeeklyTrendsData> {
    const rows = this.occurrences.filter(
      (row) =>
        row.userId === userId &&
        row.status === 'COMPLETED' &&
        row.snapshot.sourceExerciseId === exerciseId &&
        row.sets.length > 0 &&
        row.startedAt >= query.from &&
        row.startedAt <= query.to,
    );
    rows.sort(
      (a, b) =>
        b.startedAt.getTime() - a.startedAt.getTime() ||
        b.sessionId.localeCompare(a.sessionId),
    );
    const buckets = new Map<string, ExerciseWeeklyTrendsRecord>();
    const workouts = new Map<string, Set<string>>();
    const candidates = new Map<
      string,
      { weekStart: string; reps: number; loadKg: string }
    >();
    for (const row of rows) {
      const weekStart = localMonday(row.startedAt, query.timezone);
      const ids = workouts.get(weekStart) ?? new Set<string>();
      ids.add(row.sessionId);
      workouts.set(weekStart, ids);
      const bucket = buckets.get(weekStart) ?? {
        weekStart,
        completedWorkouts: '0',
        completedSets: '0',
        totalReps: '0',
        totalVolumeKg: '0',
        maxLoadKg: '0',
      };
      bucket.completedWorkouts = String(ids.size);
      for (const set of row.sets) {
        const load = new Prisma.Decimal(set.loadKg);
        bucket.completedSets = String(Number(bucket.completedSets) + 1);
        bucket.totalReps = String(Number(bucket.totalReps) + set.reps);
        bucket.totalVolumeKg = new Prisma.Decimal(bucket.totalVolumeKg)
          .plus(load.mul(set.reps))
          .toString();
        bucket.maxLoadKg = Prisma.Decimal.max(
          bucket.maxLoadKg,
          load,
        ).toString();
        const key = weekStart + ':' + set.reps;
        const previous = candidates.get(key);
        if (
          load.gt(0) &&
          set.reps >= 1 &&
          set.reps <= 20 &&
          (!previous || load.gt(previous.loadKg))
        )
          candidates.set(key, {
            weekStart,
            reps: set.reps,
            loadKg: set.loadKg,
          });
      }
      buckets.set(weekStart, bucket);
    }
    return Promise.resolve({
      exercise: rows[0]?.snapshot ?? null,
      buckets: [...buckets.values()].sort((a, b) =>
        a.weekStart.localeCompare(b.weekStart),
      ),
      estimatedCandidates: [...candidates.values()],
    });
  }
}

export const exerciseTrendInput = {
  from: '2026-09-01T00:00:00Z',
  to: '2026-09-30T23:59:59+02:00',
  timezone: 'Europe/Madrid',
};
export const expectedExerciseBuckets = [
  {
    weekStart: '2026-09-14',
    completedWorkouts: 1,
    completedSets: 2,
    totalReps: 16,
    totalVolumeKg: 1280,
    maxLoadKg: 80,
    maxEstimated1RMKg: 101.33,
  },
  {
    weekStart: '2026-09-21',
    completedWorkouts: 1,
    completedSets: 1,
    totalReps: 7,
    totalVolumeKg: 575.75,
    maxLoadKg: 82.25,
    maxEstimated1RMKg: 101.44,
  },
];
export function exerciseTrainingTrendsFixture() {
  const owner = randomUUID();
  const other = randomUUID();
  const exerciseId = randomUUID();
  const snapshot: ExerciseTrendSnapshot = {
    sourceExerciseId: exerciseId,
    name: 'Historical Bench',
    slug: 'historical-bench',
    primaryMuscle: 'CHEST',
    secondaryMuscles: ['TRICEPS'],
    equipment: 'BARBELL',
    movementPattern: 'HORIZONTAL_PUSH',
  };
  const row = (
    day: number,
    sets: ExerciseTrendFixture['sets'],
    status: ExerciseTrendFixture['status'] = 'COMPLETED',
    userId = owner,
  ): ExerciseTrendFixture => ({
    userId,
    sessionId: randomUUID(),
    startedAt: new Date(`2026-09-${day}T10:00:00Z`),
    status,
    snapshot: { ...snapshot },
    sets,
  });
  const occurrences = [
    row(14, [
      { loadKg: '80', reps: 8 },
      { loadKg: '80', reps: 8 },
    ]),
    row(18, []),
    row(21, [{ loadKg: '82.25', reps: 7 }]),
    row(22, [{ loadKg: '200', reps: 3 }], 'CANCELLED'),
    row(23, [{ loadKg: '250', reps: 1 }], 'IN_PROGRESS'),
    row(21, [{ loadKg: '300', reps: 1 }], 'COMPLETED', other),
    row(29, []),
  ];
  occurrences[2]!.snapshot.name = 'Latest historical bench';
  occurrences[6]!.snapshot.name = 'Unused snapshot must not supply metadata';
  occurrences.push({
    ...row(14, [{ loadKg: '100', reps: 5 }]),
    sessionId: occurrences[0]!.sessionId,
    snapshot: {
      ...snapshot,
      sourceExerciseId: randomUUID(),
      name: 'Different Exercise',
    },
  });
  return {
    owner,
    other,
    exerciseId,
    repository: new InMemoryExerciseTrainingTrendsRepository(occurrences),
  };
}

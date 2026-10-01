import { randomUUID } from 'node:crypto';
import { Prisma, type MuscleGroup } from '../../src/generated/prisma/client';
import type { TrainingTrendsRepository } from '../../src/training-trends/training-trends.repository';
import type {
  MuscleGroupWeeklyTrendsRecord,
  WeeklyTrainingTrendsQuery,
} from '../../src/training-trends/training-trends.types';
import {
  localMonday,
  type TrendSessionFixture,
} from './in-memory-training-trends.repository';

export interface MuscleTrendOccurrence extends TrendSessionFixture {
  sessionId: string;
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
}

// Independent oracle: raw SQL is verified separately against PostgreSQL.
export class InMemoryMuscleTrainingTrendsRepository implements Pick<
  TrainingTrendsRepository,
  'findMuscleGroupWeeklyTrends'
> {
  constructor(readonly occurrences: MuscleTrendOccurrence[]) {}
  findMuscleGroupWeeklyTrends(
    userId: string,
    query: WeeklyTrainingTrendsQuery,
  ): Promise<MuscleGroupWeeklyTrendsRecord[]> {
    const groups = new Map<
      string,
      { row: MuscleGroupWeeklyTrendsRecord; sessions: Set<string> }
    >();
    for (const occurrence of this.occurrences) {
      if (
        occurrence.userId !== userId ||
        occurrence.status !== 'COMPLETED' ||
        !occurrence.sets.length ||
        occurrence.startedAt < query.from ||
        occurrence.startedAt > query.to
      )
        continue;
      const weekStart = localMonday(occurrence.startedAt, query.timezone);
      const key = weekStart + ':' + occurrence.primaryMuscle;
      const group = groups.get(key) ?? {
        row: {
          weekStart,
          muscleGroup: occurrence.primaryMuscle,
          completedWorkouts: '0',
          completedSets: '0',
          totalReps: '0',
          totalVolumeKg: '0',
        },
        sessions: new Set<string>(),
      };
      group.sessions.add(occurrence.sessionId);
      group.row.completedWorkouts = String(group.sessions.size);
      for (const set of occurrence.sets) {
        group.row.completedSets = String(Number(group.row.completedSets) + 1);
        group.row.totalReps = String(Number(group.row.totalReps) + set.reps);
        group.row.totalVolumeKg = new Prisma.Decimal(group.row.totalVolumeKg)
          .plus(new Prisma.Decimal(set.loadKg).mul(set.reps))
          .toString();
      }
      groups.set(key, group);
    }
    return Promise.resolve(
      [...groups.values()]
        .map(({ row }) => row)
        .sort(
          (a, b) =>
            a.weekStart.localeCompare(b.weekStart) ||
            a.muscleGroup.localeCompare(b.muscleGroup),
        ),
    );
  }
}
export const muscleTrendsInput = {
  from: '2026-09-01T00:00:00Z',
  to: '2026-09-30T23:59:59+02:00',
  timezone: 'Europe/Madrid',
};
export const expectedMuscleBuckets = [
  {
    weekStart: '2026-09-14',
    muscleGroups: [
      {
        muscleGroup: 'BACK',
        completedWorkouts: 1,
        completedSets: 1,
        totalReps: 10,
        totalVolumeKg: 700,
      },
      {
        muscleGroup: 'CHEST',
        completedWorkouts: 1,
        completedSets: 3,
        totalReps: 26,
        totalVolumeKg: 1880,
      },
      {
        muscleGroup: 'TRICEPS',
        completedWorkouts: 1,
        completedSets: 2,
        totalReps: 22,
        totalVolumeKg: 660,
      },
    ],
  },
  {
    weekStart: '2026-09-21',
    muscleGroups: [
      {
        muscleGroup: 'CORE',
        completedWorkouts: 1,
        completedSets: 1,
        totalReps: 20,
        totalVolumeKg: 0,
      },
      {
        muscleGroup: 'QUADRICEPS',
        completedWorkouts: 1,
        completedSets: 2,
        totalReps: 10,
        totalVolumeKg: 1000,
      },
    ],
  },
];
export function muscleTrainingTrendsFixture() {
  const owner = randomUUID();
  const other = randomUUID();
  const row = (
    day: number,
    primaryMuscle: MuscleGroup,
    sets: MuscleTrendOccurrence['sets'],
    status: MuscleTrendOccurrence['status'] = 'COMPLETED',
    userId = owner,
  ): MuscleTrendOccurrence => ({
    userId,
    sessionId: randomUUID(),
    startedAt: new Date(`2026-09-${day}T10:00:00Z`),
    status,
    primaryMuscle,
    secondaryMuscles: [],
    sets,
  });
  const bench = row(14, 'CHEST', [
    { loadKg: '80', reps: 8 },
    { loadKg: '80', reps: 8 },
  ]);
  bench.secondaryMuscles = ['TRICEPS', 'SHOULDERS'];
  const triceps = row(18, 'TRICEPS', [
    { loadKg: '30', reps: 12 },
    { loadKg: '30', reps: 10 },
  ]);
  const quadriceps = row(21, 'QUADRICEPS', [
    { loadKg: '100', reps: 5 },
    { loadKg: '100', reps: 5 },
  ]);
  return {
    owner,
    other,
    repository: new InMemoryMuscleTrainingTrendsRepository([
      bench,
      {
        ...row(14, 'CHEST', [{ loadKg: '60', reps: 10 }]),
        sessionId: bench.sessionId,
      },
      {
        ...row(14, 'BACK', [{ loadKg: '70', reps: 10 }]),
        sessionId: bench.sessionId,
      },
      triceps,
      { ...row(18, 'CHEST', []), sessionId: triceps.sessionId },
      quadriceps,
      {
        ...row(21, 'CORE', [{ loadKg: '0', reps: 20 }]),
        sessionId: quadriceps.sessionId,
      },
      row(22, 'CHEST', [{ loadKg: '200', reps: 10 }], 'CANCELLED'),
      row(23, 'BACK', [{ loadKg: '250', reps: 10 }], 'IN_PROGRESS'),
      row(14, 'CHEST', [{ loadKg: '300', reps: 10 }], 'COMPLETED', other),
      row(28, 'CALVES', []),
    ]),
  };
}

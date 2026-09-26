import { Prisma } from '../../src/generated/prisma/client';
import type { AnalyticsRepository } from '../../src/analytics/analytics.repository';
import type {
  AnalyticsRange,
  ExerciseAnalyticsQuery,
  AnalyticsCandidateRecord,
  AnalyticsPerformanceRecord,
} from '../../src/analytics/analytics.types';
import {
  historyFixture,
  type OwnedHistory,
} from './in-memory-history.repository';

export function analyticsFixture() {
  const f = historyFixture();
  for (const record of f.records) {
    record.session.exercises = record.session.exercises.filter(
      (entry) => entry.sourceExerciseId === f.exerciseId,
    );
    for (const entry of record.session.exercises) {
      if (record === f.older) {
        entry.exerciseName = 'Older snapshot';
        entry.sets = entry.sets.slice(0, 1);
      }
      for (const set of entry.sets) {
        set.loadKg = new Prisma.Decimal(
          record === f.completed
            ? set.position === 3
              ? '82.25'
              : '80'
            : record === f.older
              ? '40'
              : '9000',
        );
        set.reps = record === f.completed ? (set.position === 3 ? 7 : 8) : 10;
      }
    }
  }
  return f;
}
function candidates(
  entries: AnalyticsPerformanceRecord[],
): AnalyticsCandidateRecord[] {
  return entries.flatMap((entry) =>
    entry.sets.map((set) => ({
      sessionId: entry.workoutSession.id,
      sessionName: entry.workoutSession.name,
      sessionStartedAt: entry.workoutSession.startedAt,
      sessionExerciseId: entry.id,
      setId: set.id,
      position: set.position,
      loadKg: set.loadKg.toString(),
      reps: set.reps,
      rpe: set.rpe?.toString() ?? null,
      rir: set.rir,
      completedAt: set.completedAt,
    })),
  );
}
export class InMemoryAnalyticsRepository implements Pick<
  AnalyticsRepository,
  'overview' | 'exercise'
> {
  constructor(readonly records: OwnedHistory[]) {}
  private matching(userId: string, range: AnalyticsRange) {
    return this.records
      .filter(
        (record) =>
          record.userId === userId &&
          record.session.status === 'COMPLETED' &&
          (!range.from || record.session.startedAt >= range.from) &&
          (!range.to || record.session.startedAt <= range.to),
      )
      .map((record) => record.session)
      .sort(
        (a, b) =>
          b.startedAt.getTime() - a.startedAt.getTime() ||
          b.id.localeCompare(a.id),
      );
  }
  overview(userId: string, range: AnalyticsRange) {
    const sessions = this.matching(userId, range);
    const sets = sessions.flatMap((session) =>
      session.exercises.flatMap((entry) => entry.sets),
    );
    return Promise.resolve({
      completedWorkouts: String(sessions.length),
      completedSets: String(sets.length),
      totalReps: String(sets.reduce((n, set) => n + set.reps, 0)),
      totalVolumeKg: sets
        .reduce(
          (n, set) => n.plus(set.loadKg.mul(set.reps)),
          new Prisma.Decimal(0),
        )
        .toString(),
    });
  }
  exercise(userId: string, exerciseId: string, query: ExerciseAnalyticsQuery) {
    const entries = this.matching(userId, query).flatMap((session) =>
      session.exercises
        .filter((entry) => entry.sourceExerciseId === exerciseId)
        .map((entry) => ({ ...entry, workoutSession: session })),
    );
    const sets = candidates(entries);
    const heaviest =
      [...sets].sort(
        (a, b) =>
          Number(b.loadKg) - Number(a.loadKg) ||
          b.reps - a.reps ||
          b.completedAt.getTime() - a.completedAt.getTime() ||
          b.setId.localeCompare(a.setId),
      )[0] ?? null;
    return Promise.resolve({
      summary: {
        sessions: String(entries.length),
        sets: String(sets.length),
        reps: String(sets.reduce((n, set) => n + set.reps, 0)),
        totalVolumeKg: sets
          .reduce(
            (n, set) => n.plus(new Prisma.Decimal(set.loadKg).mul(set.reps)),
            new Prisma.Decimal(0),
          )
          .toString(),
      },
      exercise: entries[0] ?? null,
      heaviestSet: heaviest,
      estimatedCandidates: sets.filter(
        (set) => Number(set.loadKg) > 0 && set.reps >= 1 && set.reps <= 20,
      ),
      performances: entries.slice(
        (query.page - 1) * query.limit,
        query.page * query.limit,
      ),
    });
  }
}

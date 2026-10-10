import { randomUUID } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client';
import type { HistoryRepository } from '../../src/history/history.repository';
import type {
  ExerciseHistoryQuery,
  ExerciseHistoryRecord,
  WorkoutHistoryDetailRecord,
  WorkoutHistoryQuery,
  WorkoutHistorySummaryRecord,
  RecentWorkoutRecord,
} from '../../src/history/history.types';

export interface OwnedHistory {
  userId: string;
  session: WorkoutHistoryDetailRecord;
}

export function historyFixture() {
  const owner = randomUUID();
  const other = randomUUID();
  const exerciseId = randomUUID();
  const secondExerciseId = randomUUID();
  function record(
    userId: string,
    status: WorkoutHistoryDetailRecord['status'],
    startedAt: string,
  ): OwnedHistory {
    return {
      userId,
      session: {
        id: randomUUID(),
        name: 'Push 50%_\\ Day',
        status,
        notes: 'Historical notes',
        startedAt: new Date(startedAt),
        endedAt:
          status === 'IN_PROGRESS'
            ? null
            : new Date(new Date(startedAt).getTime() + 3600000),
        exercises: [2, 1].map((position) => ({
          id: randomUUID(),
          position,
          sourceExerciseId: position === 1 ? exerciseId : secondExerciseId,
          exerciseName: position === 1 ? 'Original Bench' : 'Original Row',
          exerciseSlug: position === 1 ? 'original-bench' : 'original-row',
          primaryMuscle: 'CHEST',
          secondaryMuscles: ['TRICEPS'],
          equipment: 'BARBELL',
          movementPattern: 'HORIZONTAL_PUSH',
          plannedSets: 4,
          plannedRepsMin: 6,
          plannedRepsMax: 8,
          plannedRestSeconds: 90,
          plannedNotes: null,
          sets: (status === 'CANCELLED' ? [1] : [3, 1, 2]).map((index) => ({
            id: randomUUID(),
            position: index,
            loadKg: new Prisma.Decimal([80, 80.5, 82.25][index - 1]!),
            reps: 8,
            rpe: index === 3 ? new Prisma.Decimal('8.5') : null,
            rir: index === 3 ? 2 : null,
            completedAt: new Date(
              new Date(startedAt).getTime() + index * 60000,
            ),
          })),
        })),
      },
    };
  }
  const completed = record(owner, 'COMPLETED', '2026-09-20T10:00:00Z');
  const older = record(owner, 'COMPLETED', '2026-09-19T10:00:00Z');
  const cancelled = record(owner, 'CANCELLED', '2026-09-21T10:00:00Z');
  const active = record(owner, 'IN_PROGRESS', '2026-09-22T10:00:00Z');
  const foreign = record(other, 'COMPLETED', '2026-09-23T10:00:00Z');
  const records = [older, active, foreign, completed, cancelled];
  return {
    owner,
    other,
    exerciseId,
    secondExerciseId,
    completed,
    older,
    cancelled,
    active,
    foreign,
    records,
  };
}

export class InMemoryHistoryRepository implements Pick<
  HistoryRepository,
  | 'findWorkoutHistory'
  | 'findWorkoutHistoryById'
  | 'findExerciseHistory'
  | 'findRecentCompletedWorkouts'
> {
  constructor(readonly records: OwnedHistory[]) {}

  async findRecentCompletedWorkouts(
    userId: string,
    limit: number,
  ): Promise<RecentWorkoutRecord[]> {
    return this.records
      .filter((r) => r.userId === userId && r.session.status === 'COMPLETED')
      .map((r) => r.session)
      .sort(
        (a, b) =>
          b.startedAt.getTime() - a.startedAt.getTime() ||
          b.id.localeCompare(a.id),
      )
      .slice(0, limit)
      .map((session) => {
        const sets = session.exercises.flatMap((e) => e.sets);
        return {
          id: session.id,
          name: session.name,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          durationSeconds:
            session.endedAt === null
              ? null
              : String(
                  (session.endedAt.getTime() - session.startedAt.getTime()) /
                    1000,
                ),
          completedSets: String(sets.length),
          totalReps: String(sets.reduce((sum, s) => sum + s.reps, 0)),
          totalVolumeKg: sets
            .reduce(
              (sum, s) => sum.plus(s.loadKg.times(s.reps)),
              new Prisma.Decimal(0),
            )
            .toString(),
        };
      });
  }

  private matching(userId: string, query: WorkoutHistoryQuery) {
    return this.records
      .filter((record) => record.userId === userId)
      .map((record) => record.session)
      .filter(
        (session) =>
          session.status !== 'IN_PROGRESS' &&
          (!query.status || session.status === query.status) &&
          (!query.from || session.startedAt >= query.from) &&
          (!query.to || session.startedAt <= query.to) &&
          (!query.q ||
            session.name.toLowerCase().includes(query.q.toLowerCase())),
      )
      .sort(
        (a, b) =>
          b.startedAt.getTime() - a.startedAt.getTime() ||
          b.id.localeCompare(a.id),
      );
  }

  findWorkoutHistory(
    userId: string,
    query: WorkoutHistoryQuery,
  ): Promise<{ items: WorkoutHistorySummaryRecord[]; total: number }> {
    const records = this.matching(userId, query);
    return Promise.resolve({
      items: records
        .slice((query.page - 1) * query.limit, query.page * query.limit)
        .map((session) => ({
          id: session.id,
          name: session.name,
          status: session.status,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          exercises: session.exercises.map((entry) => ({
            _count: { sets: entry.sets.length },
          })),
        })),
      total: records.length,
    });
  }
  findWorkoutHistoryById(
    userId: string,
    id: string,
  ): Promise<WorkoutHistoryDetailRecord | null> {
    return Promise.resolve(
      this.records.find(
        (record) =>
          record.userId === userId &&
          record.session.id === id &&
          record.session.status !== 'IN_PROGRESS',
      )?.session ?? null,
    );
  }
  findExerciseHistory(
    userId: string,
    exerciseId: string,
    query: ExerciseHistoryQuery,
  ): Promise<{ items: ExerciseHistoryRecord[]; total: number }> {
    const records = this.matching(userId, query).flatMap((session) =>
      session.exercises
        .filter((entry) => entry.sourceExerciseId === exerciseId)
        .sort((a, b) => a.position - b.position)
        .map((entry) => ({
          ...entry,
          workoutSession: {
            id: session.id,
            name: session.name,
            status: session.status,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
          },
        })),
    );
    return Promise.resolve({
      items: records.slice(
        (query.page - 1) * query.limit,
        query.page * query.limit,
      ),
      total: records.length,
    });
  }
}

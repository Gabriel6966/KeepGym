import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HistoryPersistenceError } from './errors/history-persistence.error';
import {
  historyStatuses,
  workoutHistorySummarySelect,
  workoutHistoryDetailSelect,
  exerciseHistorySelect,
  type HistoryQuery,
  type WorkoutHistoryQuery,
  type ExerciseHistoryQuery,
  type WorkoutHistorySummaryRecord,
  type WorkoutHistoryDetailRecord,
  type ExerciseHistoryRecord,
  type RecentWorkoutRecord,
} from './history.types';

function sessionWhere(
  userId: string,
  query: HistoryQuery,
): Prisma.WorkoutSessionWhereInput {
  return {
    userId,
    status: {
      in: query.status === undefined ? [...historyStatuses] : [query.status],
    },
    startedAt: { gte: query.from, lte: query.to },
  };
}

@Injectable()
export class HistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findRecentCompletedWorkouts(
    userId: string,
    limit: number,
  ): Promise<RecentWorkoutRecord[]> {
    try {
      // Bound the historical sessions before aggregating their children. LEFT
      // JOIN preserves completed sessions with no exercises or no recorded sets.
      return await this.prisma.$queryRaw<RecentWorkoutRecord[]>(Prisma.sql`
        WITH recent AS MATERIALIZED (
          SELECT w.id, w.name, w.started_at, w.ended_at
          FROM workout_sessions w
          WHERE w.user_id = ${userId}::uuid AND w.status = 'COMPLETED'
          ORDER BY w.started_at DESC, w.id DESC
          LIMIT ${limit}
        )
        SELECT r.id, r.name, r.started_at AS "startedAt", r.ended_at AS "endedAt",
          EXTRACT(EPOCH FROM (r.ended_at - r.started_at))::text AS "durationSeconds",
          COUNT(s.id)::text AS "completedSets",
          COALESCE(SUM(s.reps), 0)::text AS "totalReps",
          COALESCE(SUM(s.load_kg * s.reps), 0)::text AS "totalVolumeKg"
        FROM recent r
        LEFT JOIN workout_session_exercises e ON e.workout_session_id = r.id
        LEFT JOIN set_entries s ON s.workout_session_exercise_id = e.id
        GROUP BY r.id, r.name, r.started_at, r.ended_at
        ORDER BY r.started_at DESC, r.id DESC
      `);
    } catch {
      throw new HistoryPersistenceError();
    }
  }

  async findWorkoutHistory(
    userId: string,
    query: WorkoutHistoryQuery,
  ): Promise<{ items: WorkoutHistorySummaryRecord[]; total: number }> {
    const search = query.q?.replace(/[\\%_]/g, '\\$&');
    const where: Prisma.WorkoutSessionWhereInput = {
      ...sessionWhere(userId, query),
      ...(search === undefined
        ? {}
        : { name: { contains: search, mode: 'insensitive' } }),
    };
    try {
      const [items, total] = await this.prisma.$transaction(
        [
          this.prisma.workoutSession.findMany({
            where,
            select: workoutHistorySummarySelect,
            orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          }),
          this.prisma.workoutSession.count({ where }),
        ],
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      return { items, total };
    } catch {
      throw new HistoryPersistenceError();
    }
  }

  async findWorkoutHistoryById(
    userId: string,
    id: string,
  ): Promise<WorkoutHistoryDetailRecord | null> {
    try {
      return await this.prisma.$transaction(
        (tx) =>
          tx.workoutSession.findFirst({
            where: { id, userId, status: { in: [...historyStatuses] } },
            select: workoutHistoryDetailSelect,
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    } catch {
      throw new HistoryPersistenceError();
    }
  }

  async findExerciseHistory(
    userId: string,
    exerciseId: string,
    query: ExerciseHistoryQuery,
  ): Promise<{ items: ExerciseHistoryRecord[]; total: number }> {
    const where: Prisma.WorkoutSessionExerciseWhereInput = {
      sourceExerciseId: exerciseId,
      workoutSession: sessionWhere(userId, query),
    };
    try {
      const [items, total] = await this.prisma.$transaction(
        [
          this.prisma.workoutSessionExercise.findMany({
            where,
            select: exerciseHistorySelect,
            orderBy: [
              { workoutSession: { startedAt: 'desc' } },
              { workoutSession: { id: 'desc' } },
              { position: 'asc' },
            ],
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          }),
          this.prisma.workoutSessionExercise.count({ where }),
        ],
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      return { items, total };
    } catch {
      throw new HistoryPersistenceError();
    }
  }
}

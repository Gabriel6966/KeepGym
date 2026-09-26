import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_ESTIMATED_1RM_REPS } from './analytics.math';
import { AnalyticsPersistenceError } from './errors/analytics-persistence.error';
import {
  analyticsMetadataSelect,
  analyticsPerformanceSelect,
  type AnalyticsRange,
  type ExerciseAnalyticsQuery,
  type OverviewRecord,
  type ExerciseSummaryRecord,
  type AnalyticsCandidateRecord,
  type ExerciseAnalyticsRecord,
} from './analytics.types';

function scope(userId: string, range: AnalyticsRange): Prisma.Sql {
  return Prisma.sql`w.user_id = ${userId}::uuid AND w.status = 'COMPLETED'
    ${range.from ? Prisma.sql`AND w.started_at >= ${range.from}` : Prisma.empty}
    ${range.to ? Prisma.sql`AND w.started_at <= ${range.to}` : Prisma.empty}`;
}
const candidateColumns = Prisma.sql`
  w.id AS "sessionId", w.name AS "sessionName", w.started_at AS "sessionStartedAt",
  e.id AS "sessionExerciseId", s.id AS "setId", s.position,
  s.load_kg::text AS "loadKg", s.reps, s.rpe::text AS rpe, s.rir, s.completed_at AS "completedAt"`;
const occurrenceOrder = [
  { workoutSession: { startedAt: 'desc' } },
  { workoutSession: { id: 'desc' } },
  { position: 'asc' },
] satisfies Prisma.WorkoutSessionExerciseOrderByWithRelationInput[];

@Injectable()
export class AnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async overview(
    userId: string,
    range: AnalyticsRange,
  ): Promise<OverviewRecord> {
    try {
      // A single aggregate preserves zero-set completed workouts without loading
      // their models. NUMERIC multiplication and SUM remain exact in PostgreSQL.
      const rows = await this.prisma.$queryRaw<OverviewRecord[]>(Prisma.sql`
        SELECT COUNT(DISTINCT w.id)::text AS "completedWorkouts",
          COUNT(s.id)::text AS "completedSets", COALESCE(SUM(s.reps), 0)::text AS "totalReps",
          COALESCE(SUM(s.load_kg * s.reps), 0)::text AS "totalVolumeKg"
        FROM workout_sessions w
        LEFT JOIN workout_session_exercises e ON e.workout_session_id = w.id
        LEFT JOIN set_entries s ON s.workout_session_exercise_id = e.id
        WHERE ${scope(userId, range)}`);
      if (!rows[0]) throw new AnalyticsPersistenceError();
      return rows[0];
    } catch {
      throw new AnalyticsPersistenceError();
    }
  }

  async exercise(
    userId: string,
    exerciseId: string,
    query: ExerciseAnalyticsQuery,
  ): Promise<ExerciseAnalyticsRecord> {
    const where: Prisma.WorkoutSessionExerciseWhereInput = {
      sourceExerciseId: exerciseId,
      workoutSession: {
        userId,
        status: 'COMPLETED',
        startedAt: { gte: query.from, lte: query.to },
      },
    };
    const filtered = Prisma.sql`${scope(userId, query)} AND e.source_exercise_id = ${exerciseId}::uuid`;
    const candidateFrom = Prisma.sql`FROM workout_sessions w
      JOIN workout_session_exercises e ON e.workout_session_id = w.id
      JOIN set_entries s ON s.workout_session_exercise_id = e.id
      WHERE ${filtered}`;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const summaries = await tx.$queryRaw<
            ExerciseSummaryRecord[]
          >(Prisma.sql`
          SELECT COUNT(DISTINCT e.id)::text AS sessions, COUNT(s.id)::text AS sets,
            COALESCE(SUM(s.reps), 0)::text AS reps,
            COALESCE(SUM(s.load_kg * s.reps), 0)::text AS "totalVolumeKg"
          FROM workout_sessions w
          JOIN workout_session_exercises e ON e.workout_session_id = w.id
          LEFT JOIN set_entries s ON s.workout_session_exercise_id = e.id
          WHERE ${filtered}`);
          const summary = summaries[0];
          if (!summary) throw new AnalyticsPersistenceError();
          const heaviest = await tx.$queryRaw<
            AnalyticsCandidateRecord[]
          >(Prisma.sql`
          SELECT ${candidateColumns} ${candidateFrom}
          ORDER BY s.load_kg DESC, s.reps DESC, s.completed_at DESC, s.id DESC LIMIT 1`);
          // For each eligible rep count Epley is monotonic in load. At most 20
          // candidates suffice; the service applies the central exact formula and
          // cross-rep tie-break. No full-history set materialization or SQL Epley.
          const estimatedCandidates = await tx.$queryRaw<
            AnalyticsCandidateRecord[]
          >(Prisma.sql`
          SELECT DISTINCT ON (s.reps) ${candidateColumns} ${candidateFrom}
            AND s.load_kg > 0 AND s.reps BETWEEN 1 AND ${MAX_ESTIMATED_1RM_REPS}
          ORDER BY s.reps, s.load_kg DESC, s.completed_at DESC, s.id DESC`);
          const exercise = await tx.workoutSessionExercise.findFirst({
            where,
            select: analyticsMetadataSelect,
            orderBy: occurrenceOrder,
          });
          const performances = await tx.workoutSessionExercise.findMany({
            where,
            select: analyticsPerformanceSelect,
            orderBy: occurrenceOrder,
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          });
          return {
            summary,
            exercise,
            heaviestSet: heaviest[0] ?? null,
            estimatedCandidates,
            performances,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    } catch {
      throw new AnalyticsPersistenceError();
    }
  }
}

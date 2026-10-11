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
  type ExerciseHighlightData,
  type ExerciseHighlightPerformanceRecord,
  type ExerciseHighlightCandidate,
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

  async findExerciseHighlightPerformances(
    userId: string,
    limit: number,
  ): Promise<ExerciseHighlightData> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Rank real performances before limiting distinct canonical exercises.
          // Only the selected latest/previous occurrences have their sets summed.
          const performances = await tx.$queryRaw<
            ExerciseHighlightPerformanceRecord[]
          >(Prisma.sql`
            WITH ranked_performances AS (
              SELECT e.id, e.source_exercise_id, e.exercise_name, e.exercise_slug,
                w.id AS workout_session_id, w.started_at,
                ROW_NUMBER() OVER (
                  PARTITION BY e.source_exercise_id
                  ORDER BY w.started_at DESC, w.id DESC, e.position ASC, e.id ASC
                ) AS performance_rank
              FROM workout_sessions w
              JOIN workout_session_exercises e ON e.workout_session_id = w.id
              WHERE ${scope(userId, {})} AND e.source_exercise_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM set_entries s WHERE s.workout_session_exercise_id = e.id)
            ), selected_exercises AS (
              SELECT source_exercise_id FROM ranked_performances
              WHERE performance_rank = 1
              ORDER BY started_at DESC, workout_session_id DESC, source_exercise_id ASC
              LIMIT ${limit}
            )
            SELECT p.id AS "sessionExerciseId", p.source_exercise_id AS "sourceExerciseId",
              p.exercise_name AS "exerciseName", p.exercise_slug AS "exerciseSlug",
              p.workout_session_id AS "workoutSessionId", p.started_at AS "startedAt",
              p.performance_rank::int AS "performanceRank",
              COUNT(s.id)::text AS "completedSets", SUM(s.reps)::text AS "totalReps",
              SUM(s.load_kg * s.reps)::text AS "totalVolumeKg", MAX(s.load_kg)::text AS "maxLoadKg"
            FROM ranked_performances p
            JOIN selected_exercises selected ON selected.source_exercise_id = p.source_exercise_id
            JOIN set_entries s ON s.workout_session_exercise_id = p.id
            WHERE p.performance_rank <= 2
            GROUP BY p.id, p.source_exercise_id, p.exercise_name, p.exercise_slug,
              p.workout_session_id, p.started_at, p.performance_rank
            ORDER BY p.source_exercise_id ASC, p.performance_rank ASC`);
          const ids = performances.map((row) => row.sessionExerciseId);
          const selected = ids.length
            ? Prisma.sql`e.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`
            : Prisma.sql`FALSE`;
          // At most 20 candidates per performance. Epley stays in analytics.math.
          // Even an empty feed has two SELECTs; no per-exercise round trips.
          const estimatedCandidates = await tx.$queryRaw<
            ExerciseHighlightCandidate[]
          >(Prisma.sql`
            SELECT e.id AS "sessionExerciseId", s.reps, MAX(s.load_kg)::text AS "loadKg"
            FROM workout_sessions w
            JOIN workout_session_exercises e ON e.workout_session_id = w.id
            JOIN set_entries s ON s.workout_session_exercise_id = e.id
            WHERE ${scope(userId, {})} AND e.source_exercise_id IS NOT NULL AND ${selected}
              AND s.load_kg > 0 AND s.reps BETWEEN 1 AND ${MAX_ESTIMATED_1RM_REPS}
            GROUP BY e.id, s.reps ORDER BY e.id ASC, s.reps ASC`);
          return { performances, estimatedCandidates };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    } catch {
      throw new AnalyticsPersistenceError();
    }
  }

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

import { Injectable } from '@nestjs/common';
import { MAX_ESTIMATED_1RM_REPS } from '../analytics/analytics.math';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TrainingTrendsPersistenceError } from './errors/training-trends-persistence.error';
import type {
  ExerciseTrendSnapshot,
  ExerciseWeeklyTrendsData,
  ExerciseWeeklyTrendsRecord,
  MuscleGroupWeeklyTrendsRecord,
  WeeklyEstimated1RMCandidate,
  WeeklyComparisonQuery,
  WeeklyTrainingTrendsQuery,
  WeeklyTrainingTrendsRecord,
} from './training-trends.types';

function localWeek(timezone: string): Prisma.Sql {
  return Prisma.sql`to_char(date_trunc('week', w.started_at AT TIME ZONE ${timezone}), 'YYYY-MM-DD')`;
}

function exerciseScope(
  userId: string,
  exerciseId: string,
  query: WeeklyTrainingTrendsQuery,
): Prisma.Sql {
  // Explicit offsets keep timestamptz parameters independent of connection TZ.
  return Prisma.sql`w.user_id = ${userId}::uuid AND w.status = 'COMPLETED'
    AND e.source_exercise_id = ${exerciseId}::uuid
    AND w.started_at >= ${query.from.toISOString()}::timestamptz
    AND w.started_at <= ${query.to.toISOString()}::timestamptz`;
}

@Injectable()
export class TrainingTrendsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findWeeklyComparison(
    userId: string,
    query: WeeklyComparisonQuery,
  ): Promise<WeeklyTrainingTrendsRecord[]> {
    try {
      // One statement, one snapshot. Date +/- 7 means calendar days BEFORE each
      // midnight is converted to an instant: DST weeks need not last 168 hours.
      return await this.prisma.$queryRaw<
        WeeklyTrainingTrendsRecord[]
      >(Prisma.sql`
        WITH local_week AS (
          SELECT ${query.weekStart}::date AS monday, ${query.timezone}::text AS zone
        ), boundaries AS (
          SELECT monday,
            (monday - 7)::timestamp AT TIME ZONE zone AS previous_start,
            monday::timestamp AT TIME ZONE zone AS current_start,
            (monday + 7)::timestamp AT TIME ZONE zone AS current_end
          FROM local_week
        )
        SELECT to_char(CASE WHEN w.started_at < b.current_start
            THEN b.monday - 7 ELSE b.monday END, 'YYYY-MM-DD') AS "weekStart",
          COUNT(DISTINCT w.id)::text AS "completedWorkouts",
          COUNT(s.id)::text AS "completedSets",
          COALESCE(SUM(s.reps), 0)::text AS "totalReps",
          COALESCE(SUM(s.load_kg * s.reps), 0)::text AS "totalVolumeKg"
        FROM boundaries b
        JOIN workout_sessions w ON w.user_id = ${userId}::uuid
          AND w.status = 'COMPLETED'
          AND w.started_at >= b.previous_start AND w.started_at < b.current_end
        LEFT JOIN workout_session_exercises e ON e.workout_session_id = w.id
        LEFT JOIN set_entries s ON s.workout_session_exercise_id = e.id
        GROUP BY 1 ORDER BY 1 ASC`);
    } catch {
      throw new TrainingTrendsPersistenceError();
    }
  }

  async findMuscleGroupWeeklyTrends(
    userId: string,
    query: WeeklyTrainingTrendsQuery,
  ): Promise<MuscleGroupWeeklyTrendsRecord[]> {
    try {
      // One statement gives a consistent read. Each set belongs only to its
      // snapshot's primary muscle; no secondary expansion or mutable catalog join.
      return await this.prisma.$queryRaw<
        MuscleGroupWeeklyTrendsRecord[]
      >(Prisma.sql`
        SELECT ${localWeek(query.timezone)} AS "weekStart",
          e.primary_muscle::text COLLATE "C" AS "muscleGroup",
          COUNT(DISTINCT w.id)::text AS "completedWorkouts",
          COUNT(s.id)::text AS "completedSets",
          SUM(s.reps)::text AS "totalReps",
          SUM(s.load_kg * s.reps)::text AS "totalVolumeKg"
        FROM workout_sessions w
        JOIN workout_session_exercises e ON e.workout_session_id = w.id
        JOIN set_entries s ON s.workout_session_exercise_id = e.id
        WHERE w.user_id = ${userId}::uuid AND w.status = 'COMPLETED'
          AND w.started_at >= ${query.from.toISOString()}::timestamptz
          AND w.started_at <= ${query.to.toISOString()}::timestamptz
        GROUP BY 1, 2 ORDER BY 1 ASC, 2 ASC`);
    } catch {
      throw new TrainingTrendsPersistenceError();
    }
  }

  async findWeeklyTrends(
    userId: string,
    query: WeeklyTrainingTrendsQuery,
  ): Promise<WeeklyTrainingTrendsRecord[]> {
    try {
      // AT TIME ZONE produces a local timestamp before ISO/Monday truncation.
      // A date-only string avoids driver/process timezone shifts and DateStyle.
      // One statement is one consistent snapshot, including zero-set workouts.
      return await this.prisma.$queryRaw<
        WeeklyTrainingTrendsRecord[]
      >(Prisma.sql`
        SELECT ${localWeek(query.timezone)} AS "weekStart",
          COUNT(DISTINCT w.id)::text AS "completedWorkouts",
          COUNT(s.id)::text AS "completedSets",
          COALESCE(SUM(s.reps), 0)::text AS "totalReps",
          COALESCE(SUM(s.load_kg * s.reps), 0)::text AS "totalVolumeKg"
        FROM workout_sessions w
        LEFT JOIN workout_session_exercises e ON e.workout_session_id = w.id
        LEFT JOIN set_entries s ON s.workout_session_exercise_id = e.id
        WHERE w.user_id = ${userId}::uuid AND w.status = 'COMPLETED'
          AND w.started_at >= ${query.from}::timestamptz
          AND w.started_at <= ${query.to}::timestamptz
        GROUP BY 1 ORDER BY 1 ASC`);
    } catch {
      throw new TrainingTrendsPersistenceError();
    }
  }

  async findExerciseWeeklyTrends(
    userId: string,
    exerciseId: string,
    query: WeeklyTrainingTrendsQuery,
  ): Promise<ExerciseWeeklyTrendsData> {
    try {
      const scope = exerciseScope(userId, exerciseId, query);
      const week = localWeek(query.timezone);
      // Unlike global trends, INNER JOIN excludes occurrences without actual sets.
      // Three fixed reads share one snapshot even during concurrent corrections.
      return await this.prisma.$transaction(
        async (tx) => {
          const buckets = await tx.$queryRaw<
            ExerciseWeeklyTrendsRecord[]
          >(Prisma.sql`
          SELECT ${week} AS "weekStart",
            COUNT(DISTINCT w.id)::text AS "completedWorkouts",
            COUNT(s.id)::text AS "completedSets",
            SUM(s.reps)::text AS "totalReps",
            SUM(s.load_kg * s.reps)::text AS "totalVolumeKg",
            MAX(s.load_kg)::text AS "maxLoadKg"
          FROM workout_sessions w
          JOIN workout_session_exercises e ON e.workout_session_id = w.id
          JOIN set_entries s ON s.workout_session_exercise_id = e.id
          WHERE ${scope}
          GROUP BY 1 ORDER BY 1 ASC`);

          // Epley is monotone in load for fixed reps. Return <=20 candidates/week,
          // without reproducing the formula or introducing record-holder semantics.
          const estimatedCandidates = await tx.$queryRaw<
            WeeklyEstimated1RMCandidate[]
          >(Prisma.sql`
          SELECT ${week} AS "weekStart", s.reps,
            MAX(s.load_kg)::text AS "loadKg"
          FROM workout_sessions w
          JOIN workout_session_exercises e ON e.workout_session_id = w.id
          JOIN set_entries s ON s.workout_session_exercise_id = e.id
          WHERE ${scope} AND s.load_kg > 0
            AND s.reps BETWEEN 1 AND ${MAX_ESTIMATED_1RM_REPS}
          GROUP BY 1, s.reps ORDER BY 1 ASC, s.reps ASC`);

          // Cast the enum array to a built-in PG array type recognized by the driver.
          const metadata = await tx.$queryRaw<
            ExerciseTrendSnapshot[]
          >(Prisma.sql`
          SELECT e.source_exercise_id AS "sourceExerciseId",
            e.exercise_name AS name, e.exercise_slug AS slug,
            e.primary_muscle AS "primaryMuscle", e.secondary_muscles::text[] AS "secondaryMuscles",
            e.equipment, e.movement_pattern AS "movementPattern"
          FROM workout_sessions w
          JOIN workout_session_exercises e ON e.workout_session_id = w.id
          WHERE ${scope}
            AND EXISTS (SELECT 1 FROM set_entries s WHERE s.workout_session_exercise_id = e.id)
          ORDER BY w.started_at DESC, w.id DESC, e.position ASC, e.id ASC
          LIMIT 1`);
          return {
            buckets,
            estimatedCandidates,
            exercise: metadata[0] ?? null,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    } catch {
      throw new TrainingTrendsPersistenceError();
    }
  }
}

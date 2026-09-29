import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TrainingTrendsPersistenceError } from './errors/training-trends-persistence.error';
import type {
  WeeklyTrainingTrendsQuery,
  WeeklyTrainingTrendsRecord,
} from './training-trends.types';

@Injectable()
export class TrainingTrendsRepository {
  constructor(private readonly prisma: PrismaService) {}

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
        SELECT to_char(date_trunc('week', w.started_at AT TIME ZONE ${query.timezone}), 'YYYY-MM-DD') AS "weekStart",
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
}

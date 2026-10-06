import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TrainingDurationPersistenceError } from './errors/training-duration-persistence.error';
import type {
  WeeklyDurationRecord,
  WeeklyTrainingDurationQuery,
} from './training-duration.types';

@Injectable()
export class TrainingDurationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findWeeklyDurations(
    userId: string,
    query: WeeklyTrainingDurationQuery,
  ): Promise<WeeklyDurationRecord[]> {
    try {
      // One snapshot/read: do not filter corrupt rows or invent missing endedAt.
      // Local calendar grouping and absolute instant subtraction are independent.
      return await this.prisma.$queryRaw<WeeklyDurationRecord[]>(Prisma.sql`
        SELECT to_char(date_trunc('week', w.started_at AT TIME ZONE ${query.timezone}), 'YYYY-MM-DD') AS "weekStart",
          COUNT(w.id)::text AS "completedWorkouts",
          SUM(EXTRACT(EPOCH FROM (w.ended_at - w.started_at)))::text AS "totalDurationSeconds",
          COUNT(*) FILTER (WHERE w.ended_at IS NULL OR w.ended_at < w.started_at)::text AS "invalidDurationCount"
        FROM workout_sessions w
        WHERE w.user_id = ${userId}::uuid AND w.status = 'COMPLETED'
          AND w.started_at >= ${query.from.toISOString()}::timestamptz
          AND w.started_at <= ${query.to.toISOString()}::timestamptz
        GROUP BY 1 ORDER BY 1 ASC`);
    } catch {
      throw new TrainingDurationPersistenceError();
    }
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TrainingConsistencyPersistenceError } from './errors/training-consistency-persistence.error';
import type {
  WeeklyActivityRecord,
  WeeklyConsistencyQuery,
} from './training-consistency.types';

@Injectable()
export class TrainingConsistencyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findWeeklyActivity(
    userId: string,
    query: WeeklyConsistencyQuery,
  ): Promise<WeeklyActivityRecord[]> {
    try {
      // A single snapshot of WorkoutSession only: activity does not require sets.
      // Convert each local calendar boundary independently, preserving DST.
      return await this.prisma.$queryRaw<WeeklyActivityRecord[]>(Prisma.sql`
        WITH period AS (
          SELECT ${query.fromWeekStart}::date AS first_monday,
            ${query.toWeekStart}::date AS last_monday, ${query.timezone}::text AS zone
        )
        SELECT to_char(date_trunc('week', w.started_at AT TIME ZONE p.zone), 'YYYY-MM-DD') AS "weekStart",
          COUNT(w.id)::text AS "completedWorkouts",
          COUNT(DISTINCT (w.started_at AT TIME ZONE p.zone)::date)::text AS "activeDays"
        FROM workout_sessions w CROSS JOIN period p
        WHERE w.user_id = ${userId}::uuid AND w.status = 'COMPLETED'
          AND w.started_at >= (p.first_monday::timestamp AT TIME ZONE p.zone)
          AND w.started_at < ((p.last_monday + 7)::timestamp AT TIME ZONE p.zone)
        GROUP BY 1 ORDER BY 1 ASC`);
    } catch {
      throw new TrainingConsistencyPersistenceError();
    }
  }
}

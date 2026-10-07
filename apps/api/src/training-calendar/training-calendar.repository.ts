import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TrainingCalendarPersistenceError } from './errors/training-calendar-persistence.error';
import type {
  DailyActivityRecord,
  TrainingCalendarQuery,
} from './training-calendar.types';

@Injectable()
export class TrainingCalendarRepository {
  constructor(private readonly prisma: PrismaService) {}
  async findDailyActivity(
    userId: string,
    query: TrainingCalendarQuery,
  ): Promise<DailyActivityRecord[]> {
    try {
      // One statement/read snapshot. Preaggregate once per session so neither
      // duration nor workout count is multiplied by the number of sets/exercises.
      return await this.prisma.$queryRaw<DailyActivityRecord[]>(Prisma.sql`
        WITH period AS (
          SELECT ${query.fromDate}::date AS first_day, ${query.toDate}::date AS last_day,
            ${query.timezone}::text AS zone
        ), session_activity AS (
          SELECT w.id, to_char(w.started_at AT TIME ZONE p.zone, 'YYYY-MM-DD') AS local_date,
            EXTRACT(EPOCH FROM (w.ended_at - w.started_at)) AS duration_seconds,
            (w.ended_at IS NULL OR w.ended_at < w.started_at) AS invalid_duration,
            COUNT(s.id) AS completed_sets, COALESCE(SUM(s.reps), 0) AS total_reps,
            COALESCE(SUM(s.load_kg * s.reps), 0) AS total_volume_kg
          FROM workout_sessions w CROSS JOIN period p
          LEFT JOIN workout_session_exercises e ON e.workout_session_id = w.id
          LEFT JOIN set_entries s ON s.workout_session_exercise_id = e.id
          WHERE w.user_id = ${userId}::uuid AND w.status = 'COMPLETED'
            AND w.started_at >= (p.first_day::timestamp AT TIME ZONE p.zone)
            AND w.started_at < ((p.last_day + 1)::timestamp AT TIME ZONE p.zone)
          GROUP BY w.id, p.zone
        )
        SELECT local_date AS date, COUNT(*)::text AS "completedWorkouts",
          SUM(completed_sets)::text AS "completedSets", SUM(total_reps)::text AS "totalReps",
          SUM(total_volume_kg)::text AS "totalVolumeKg", SUM(duration_seconds)::text AS "totalDurationSeconds",
          COUNT(*) FILTER (WHERE invalid_duration)::text AS "invalidDurationCount"
        FROM session_activity GROUP BY local_date ORDER BY local_date ASC`);
    } catch {
      throw new TrainingCalendarPersistenceError();
    }
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_ESTIMATED_1RM_REPS } from '../analytics/analytics.math';
import { RecordsPersistenceError } from './errors/records-persistence.error';
import {
  recordExerciseSelect,
  type ExerciseRecordData,
  type RecordCandidate,
} from './records.types';

const candidateColumns = Prisma.sql`
  w.id AS "sessionId", w.name AS "sessionName", w.started_at AS "sessionStartedAt",
  s.id AS "setId", s.position, s.load_kg::text AS "loadKg", s.reps,
  s.rpe::text AS rpe, s.rir, s.completed_at AS "completedAt"`;

@Injectable()
export class RecordsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findExerciseRecordData(
    userId: string,
    exerciseId: string,
  ): Promise<ExerciseRecordData> {
    const candidatesFrom = Prisma.sql`
      FROM workout_sessions w
      JOIN workout_session_exercises e ON e.workout_session_id = w.id
      JOIN set_entries s ON s.workout_session_exercise_id = e.id
      WHERE w.user_id = ${userId}::uuid AND w.status = 'COMPLETED'
        AND e.source_exercise_id = ${exerciseId}::uuid AND s.load_kg > 0`;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const exercise = await tx.workoutSessionExercise.findFirst({
            where: {
              sourceExerciseId: exerciseId,
              workoutSession: { userId, status: 'COMPLETED' },
            },
            select: recordExerciseSelect,
            orderBy: [
              { workoutSession: { startedAt: 'desc' } },
              { workoutSession: { id: 'desc' } },
              { position: 'asc' },
            ],
          });
          // Reps do not break MAX_LOAD ties: retain the first achievement.
          const maxLoad = await tx.$queryRaw<RecordCandidate[]>(Prisma.sql`
          SELECT ${candidateColumns} ${candidatesFrom}
          ORDER BY s.load_kg DESC, s.completed_at ASC, s.id ASC LIMIT 1`);
          // Epley is monotonic in load for a fixed rep count. Keep the earliest
          // highest-load candidate for each count; the shared math ranks at most
          // 20 rows exactly in the service, without duplicating Epley in SQL.
          const estimatedCandidates = await tx.$queryRaw<
            RecordCandidate[]
          >(Prisma.sql`
          SELECT DISTINCT ON (s.reps) ${candidateColumns} ${candidatesFrom}
            AND s.reps BETWEEN 1 AND ${MAX_ESTIMATED_1RM_REPS}
          ORDER BY s.reps, s.load_kg DESC, s.completed_at ASC, s.id ASC`);
          return { exercise, maxLoad: maxLoad[0] ?? null, estimatedCandidates };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    } catch {
      throw new RecordsPersistenceError();
    }
  }
}

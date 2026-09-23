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

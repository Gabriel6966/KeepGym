import { Injectable } from '@nestjs/common';
import { Prisma, type Exercise } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ExercisePersistenceError } from './errors/exercise-persistence.error';
import type { ExerciseListQuery } from './exercises.types';

@Injectable()
export class ExercisesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    query: ExerciseListQuery,
  ): Promise<{ items: Exercise[]; total: number }> {
    // Prisma contains uses LIKE/ILIKE: treat user %/_/backslash as literal text.
    const search = query.q?.replace(/[\\%_]/g, '\\$&');
    const where: Prisma.ExerciseWhereInput = {
      isActive: true,
      primaryMuscle: query.primaryMuscle,
      equipment: query.equipment,
      movementPattern: query.movementPattern,
      ...(search === undefined
        ? {}
        : {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { slug: { contains: search, mode: 'insensitive' } },
            ],
          }),
    };
    try {
      // Count and page share a snapshot even if a seed updates the catalog.
      const [items, total] = await this.prisma.$transaction(
        [
          this.prisma.exercise.findMany({
            where,
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          }),
          this.prisma.exercise.count({ where }),
        ],
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      return { items, total };
    } catch {
      throw new ExercisePersistenceError();
    }
  }

  async findById(id: string): Promise<Exercise | null> {
    try {
      return await this.prisma.exercise.findFirst({
        where: { id, isActive: true },
      });
    } catch {
      throw new ExercisePersistenceError();
    }
  }
}

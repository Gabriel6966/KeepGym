import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BodyMeasurementNotFoundError } from './errors/body-measurement-not-found.error';
import { BodyMeasurementPersistenceError } from './errors/body-measurement-persistence.error';
import { InvalidBodyMeasurementError } from './errors/invalid-body-measurement.error';
import type {
  BodyMeasurementChanges,
  BodyMeasurementQuery,
  BodyMeasurementRecord,
} from './body-measurements.types';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMeasurementCheck(error: unknown): boolean {
  if (!record(error)) return false;
  // adapter-pg preserves SQLSTATE on its cause. Match only our CHECKs, never
  // classify an unrelated SQL/connection/foreign-key failure as invalid input.
  const adapter = record(error.meta) ? error.meta.driverAdapterError : error;
  if (!record(adapter) || !record(adapter.cause)) return false;
  const cause = adapter.cause;
  return (
    cause.originalCode === '23514' &&
    typeof cause.originalMessage === 'string' &&
    /"body_measurements_(?:weight|body_fat|waist|chest|hips|metric)_check"/.test(
      cause.originalMessage,
    )
  );
}

function safeError(error: unknown): never {
  if (
    error instanceof BodyMeasurementNotFoundError ||
    error instanceof InvalidBodyMeasurementError
  )
    throw error;
  if (isMeasurementCheck(error)) throw new InvalidBodyMeasurementError();
  throw new BodyMeasurementPersistenceError();
}

function decimal(
  value: number | null | undefined,
): Prisma.Decimal | null | undefined {
  return value === null || value === undefined
    ? value
    : new Prisma.Decimal(value.toString());
}

// Only writable fields, preserving absent vs null. No identity/timestamp input.
function data(input: BodyMeasurementChanges) {
  return {
    measuredAt: input.measuredAt,
    weightKg: decimal(input.weightKg),
    bodyFatPercent: decimal(input.bodyFatPercent),
    waistCm: decimal(input.waistCm),
    chestCm: decimal(input.chestCm),
    hipsCm: decimal(input.hipsCm),
    notes: input.notes,
  };
}

@Injectable()
export class BodyMeasurementsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    input: BodyMeasurementChanges,
  ): Promise<BodyMeasurementRecord> {
    try {
      return await this.prisma.bodyMeasurement.create({
        data: { ...data(input), userId },
      });
    } catch (error: unknown) {
      safeError(error);
    }
  }

  async findManyByUser(
    userId: string,
    query: BodyMeasurementQuery,
  ): Promise<{ items: BodyMeasurementRecord[]; total: number }> {
    const where: Prisma.BodyMeasurementWhereInput = {
      userId,
      measuredAt: { gte: query.from, lte: query.to },
    };
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const items = await tx.bodyMeasurement.findMany({
            where,
            orderBy: [{ measuredAt: 'desc' }, { id: 'desc' }],
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          });
          const total = await tx.bodyMeasurement.count({ where });
          return { items, total };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    } catch (error: unknown) {
      safeError(error);
    }
  }

  async findByIdAndUser(
    userId: string,
    id: string,
  ): Promise<BodyMeasurementRecord | null> {
    try {
      return await this.prisma.bodyMeasurement.findFirst({
        where: { id, userId },
      });
    } catch (error: unknown) {
      safeError(error);
    }
  }

  async updateByIdAndUser(
    userId: string,
    id: string,
    input: BodyMeasurementChanges,
    validateResult: (current: Readonly<BodyMeasurementRecord>) => void,
  ): Promise<BodyMeasurementRecord> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Serialize corrections to this owned observation. READ COMMITTED's
          // following read sees the latest committed row after waiting for a lock.
          const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT "id" FROM "body_measurements"
          WHERE "id" = ${id}::uuid AND "user_id" = ${userId}::uuid
          FOR UPDATE
        `);
          if (locked.length === 0) throw new BodyMeasurementNotFoundError();
          const current = await tx.bodyMeasurement.findFirst({
            where: { id, userId },
          });
          if (!current) throw new BodyMeasurementNotFoundError();
          validateResult(current);
          return tx.bodyMeasurement.update({
            where: { id, userId },
            data: data(input),
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (error: unknown) {
      safeError(error);
    }
  }

  async deleteByIdAndUser(userId: string, id: string): Promise<void> {
    try {
      const result = await this.prisma.bodyMeasurement.deleteMany({
        where: { id, userId },
      });
      if (result.count === 0) throw new BodyMeasurementNotFoundError();
    } catch (error: unknown) {
      safeError(error);
    }
  }
}

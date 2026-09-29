import { randomUUID } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client';
import type { BodyMeasurementsRepository } from '../../src/body-measurements/body-measurements.repository';
import type {
  BodyMeasurementChanges,
  BodyMeasurementQuery,
  BodyMeasurementRecord,
} from '../../src/body-measurements/body-measurements.types';
import { metricFields } from '../../src/body-measurements/body-measurements.validation';
import { BodyMeasurementNotFoundError } from '../../src/body-measurements/errors/body-measurement-not-found.error';

export function measurementFixture(
  userId: string = randomUUID(),
): BodyMeasurementRecord {
  const now = new Date();
  return {
    id: randomUUID(),
    userId,
    measuredAt: now,
    weightKg: null,
    bodyFatPercent: null,
    waistCm: null,
    chestCm: null,
    hipsCm: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
  };
}

function apply(
  current: BodyMeasurementRecord,
  input: BodyMeasurementChanges,
): BodyMeasurementRecord {
  const next = { ...current, updatedAt: new Date() };
  for (const field of metricFields) {
    const value = input[field];
    if (value !== undefined)
      next[field] =
        value === null ? null : new Prisma.Decimal(value.toString());
  }
  if (input.measuredAt !== undefined) next.measuredAt = input.measuredAt;
  if (input.notes !== undefined) next.notes = input.notes;
  return next;
}

export class InMemoryBodyMeasurementsRepository implements Pick<
  BodyMeasurementsRepository,
  | 'create'
  | 'findManyByUser'
  | 'findByIdAndUser'
  | 'updateByIdAndUser'
  | 'deleteByIdAndUser'
> {
  readonly records = new Map<string, BodyMeasurementRecord>();

  async create(
    userId: string,
    input: BodyMeasurementChanges,
  ): Promise<BodyMeasurementRecord> {
    const row = apply(measurementFixture(userId), input);
    this.records.set(row.id, row);
    return { ...row };
  }

  async findManyByUser(userId: string, query: BodyMeasurementQuery) {
    const rows = [...this.records.values()]
      .filter(
        (row) =>
          row.userId === userId &&
          (!query.from || row.measuredAt >= query.from) &&
          (!query.to || row.measuredAt <= query.to),
      )
      .sort(
        (a, b) =>
          b.measuredAt.getTime() - a.measuredAt.getTime() ||
          b.id.localeCompare(a.id),
      );
    return {
      items: rows.slice(
        (query.page - 1) * query.limit,
        query.page * query.limit,
      ),
      total: rows.length,
    };
  }

  async findByIdAndUser(
    userId: string,
    id: string,
  ): Promise<BodyMeasurementRecord | null> {
    const row = this.records.get(id);
    return row?.userId === userId ? { ...row } : null;
  }

  async updateByIdAndUser(
    userId: string,
    id: string,
    input: BodyMeasurementChanges,
    validateResult: (current: Readonly<BodyMeasurementRecord>) => void,
  ): Promise<BodyMeasurementRecord> {
    const current = await this.findByIdAndUser(userId, id);
    if (!current) throw new BodyMeasurementNotFoundError();
    validateResult(current);
    const row = apply(current, input);
    this.records.set(id, row);
    return { ...row };
  }

  async deleteByIdAndUser(userId: string, id: string): Promise<void> {
    if (!(await this.findByIdAndUser(userId, id)))
      throw new BodyMeasurementNotFoundError();
    this.records.delete(id);
  }
}

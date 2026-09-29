import { Injectable } from '@nestjs/common';
import { BodyMeasurementsRepository } from './body-measurements.repository';
import { BodyMeasurementNotFoundError } from './errors/body-measurement-not-found.error';
import { InvalidBodyMeasurementError } from './errors/invalid-body-measurement.error';
import {
  assertMeasurementHasMetric,
  assertMeasurementIds,
  normalizeMeasurementChanges,
  normalizeMeasurementQuery,
} from './body-measurements.validation';
import type {
  BodyMeasurementInput,
  BodyMeasurementPage,
  BodyMeasurementQueryInput,
  BodyMeasurementRecord,
  PublicBodyMeasurement,
} from './body-measurements.types';

function toPublic(record: BodyMeasurementRecord): PublicBodyMeasurement {
  return {
    id: record.id,
    measuredAt: record.measuredAt,
    weightKg: record.weightKg?.toNumber() ?? null,
    bodyFatPercent: record.bodyFatPercent?.toNumber() ?? null,
    waistCm: record.waistCm?.toNumber() ?? null,
    chestCm: record.chestCm?.toNumber() ?? null,
    hipsCm: record.hipsCm?.toNumber() ?? null,
    notes: record.notes,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

@Injectable()
export class BodyMeasurementsService {
  constructor(private readonly repository: BodyMeasurementsRepository) {}

  async create(
    userId: string,
    input: BodyMeasurementInput,
  ): Promise<PublicBodyMeasurement> {
    assertMeasurementIds(userId);
    const now = new Date();
    const changes = normalizeMeasurementChanges(input, now);
    assertMeasurementHasMetric(changes);
    return toPublic(
      await this.repository.create(userId, {
        ...changes,
        measuredAt: changes.measuredAt ?? now,
      }),
    );
  }

  async list(
    userId: string,
    input: BodyMeasurementQueryInput,
  ): Promise<BodyMeasurementPage> {
    assertMeasurementIds(userId);
    const query = normalizeMeasurementQuery(input);
    const { items, total } = await this.repository.findManyByUser(
      userId,
      query,
    );
    return {
      items: items.map(toPublic),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getById(userId: string, id: string): Promise<PublicBodyMeasurement> {
    assertMeasurementIds(userId, id);
    const record = await this.repository.findByIdAndUser(userId, id);
    if (!record) throw new BodyMeasurementNotFoundError();
    return toPublic(record);
  }

  async update(
    userId: string,
    id: string,
    input: BodyMeasurementInput,
  ): Promise<PublicBodyMeasurement> {
    assertMeasurementIds(userId, id);
    const changes = normalizeMeasurementChanges(input);
    if (Object.keys(changes).length === 0)
      throw new InvalidBodyMeasurementError(
        'At least one measurement field must be provided.',
      );
    // The repository invokes this domain rule on the latest locked row, not a
    // stale read performed before the write transaction.
    return toPublic(
      await this.repository.updateByIdAndUser(userId, id, changes, (current) =>
        assertMeasurementHasMetric({ ...current, ...changes }),
      ),
    );
  }

  async remove(userId: string, id: string): Promise<void> {
    assertMeasurementIds(userId, id);
    await this.repository.deleteByIdAndUser(userId, id);
  }
}

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { BodyMeasurementsRepository } from '../src/body-measurements/body-measurements.repository';
import { BodyMeasurementsService } from '../src/body-measurements/body-measurements.service';
import { BodyMeasurementNotFoundError } from '../src/body-measurements/errors/body-measurement-not-found.error';
import { InvalidBodyMeasurementError } from '../src/body-measurements/errors/invalid-body-measurement.error';
import type {
  BodyMeasurementInput,
  BodyMeasurementQueryInput,
} from '../src/body-measurements/body-measurements.types';
import {
  metricFields,
  normalizeMeasurementChanges,
} from '../src/body-measurements/body-measurements.validation';
import { InMemoryBodyMeasurementsRepository } from './support/in-memory-body-measurements.repository';

async function setup(context: TestContext) {
  const repository = new InMemoryBodyMeasurementsRepository();
  const create = context.mock.method(repository, 'create');
  const find = context.mock.method(repository, 'findByIdAndUser');
  const list = context.mock.method(repository, 'findManyByUser');
  const update = context.mock.method(repository, 'updateByIdAndUser');
  const module = await Test.createTestingModule({
    providers: [
      BodyMeasurementsService,
      { provide: BodyMeasurementsRepository, useValue: repository },
    ],
  }).compile();
  context.after(() => module.close());
  return {
    service: module.get(BodyMeasurementsService),
    repository,
    create,
    find,
    list,
    update,
    user: randomUUID(),
  };
}

void test('measurement create delegates owned canonical numbers, defaults measuredAt and returns an explicit numeric allowlist', async (context) => {
  const f = await setup(context);
  const before = Date.now();
  const row = await f.service.create(f.user, {
    weightKg: 82.25,
    notes: '  morning  ',
  });
  assert.ok(
    row.measuredAt.getTime() >= before &&
      row.measuredAt.getTime() <= Date.now(),
  );
  assert.equal(row.weightKg, 82.25);
  assert.equal(row.bodyFatPercent, null);
  assert.equal(row.notes, 'morning');
  assert.deepEqual(Object.keys(row).sort(), [
    'bodyFatPercent',
    'chestCm',
    'createdAt',
    'hipsCm',
    'id',
    'measuredAt',
    'notes',
    'updatedAt',
    'waistCm',
    'weightKg',
  ]);
  assert.deepEqual(f.create.mock.calls[0]?.arguments, [
    f.user,
    { weightKg: 82.25, notes: 'morning', measuredAt: row.measuredAt },
  ]);
  assert.equal(f.find.mock.callCount(), 0);
});

void test('measurement supports multiple/individual metrics and exact Decimal public round-trips', async (context) => {
  const { service, user } = await setup(context);
  for (const weightKg of [82, 82.5, 82.25]) {
    const row = await service.create(user, {
      weightKg,
      bodyFatPercent: 15.75,
      waistCm: 84.33,
      chestCm: 102.3,
      hipsCm: 98.4,
    });
    assert.equal(row.weightKg, weightKg);
    assert.equal(row.bodyFatPercent, 15.75);
    assert.equal(row.waistCm, 84.33);
    assert.equal(typeof row.chestCm, 'number');
  }
  for (const field of metricFields) {
    const row = await service.create(user, { [field]: 1 });
    assert.equal(row[field], 1);
  }
});

void test('measurement domain rejects no metrics and invalid numeric values without relying on DTOs', async (context) => {
  const { service, user } = await setup(context);
  for (const input of [
    {},
    { notes: 'only notes' },
    { weightKg: null, waistCm: null },
  ])
    await assert.rejects(
      service.create(user, input),
      InvalidBodyMeasurementError,
    );
  for (const field of metricFields) {
    for (const value of [
      '82.4',
      true,
      [],
      {},
      NaN,
      Infinity,
      -Infinity,
      0,
      -1,
      82.123,
      1001,
    ])
      await assert.rejects(
        service.create(user, { [field]: value } as BodyMeasurementInput),
        InvalidBodyMeasurementError,
      );
  }
  for (const input of [{ notes: 'x'.repeat(1001) }, { notes: 4 }])
    await assert.rejects(
      service.create(user, { weightKg: 82, ...input } as BodyMeasurementInput),
      InvalidBodyMeasurementError,
    );
});

void test('measurement timestamps are zoned, real and at most 60 seconds ahead; input precision is preserved', async (context) => {
  const { service, user } = await setup(context);
  const row = await service.create(user, {
    weightKg: 82,
    measuredAt: '2026-08-01T08:00:00+02:00',
  });
  assert.equal(row.measuredAt.toISOString(), '2026-08-01T06:00:00.000Z');
  const now = new Date('2026-09-28T12:00:00Z');
  assert.ok(
    normalizeMeasurementChanges({ measuredAt: '2026-09-28T12:01:00Z' }, now),
  );
  assert.throws(
    () =>
      normalizeMeasurementChanges(
        { measuredAt: '2026-09-28T12:01:00.001Z' },
        now,
      ),
    InvalidBodyMeasurementError,
  );
  for (const measuredAt of [
    null,
    '',
    '2026-02-31T00:00:00Z',
    '2026-09-01',
    '2026-09-01T00:00:00',
    '2026-09-01T00:00:00.1234Z',
    '9999-01-01T00:00:00Z',
  ])
    await assert.rejects(
      service.create(user, {
        weightKg: 82,
        measuredAt,
      } as BodyMeasurementInput),
      InvalidBodyMeasurementError,
    );
});

void test('measurement list defaults all-time, scopes owner, filters inclusively and paginates by measuredAt/id descending', async (context) => {
  const f = await setup(context);
  for (const measuredAt of [
    '2026-08-01T00:00:00Z',
    '2026-09-01T00:00:00Z',
    '2026-09-20T00:00:00Z',
  ])
    await f.service.create(f.user, { weightKg: 82, measuredAt });
  await f.service.create(randomUUID(), { weightKg: 90 });
  const all = await f.service.list(f.user, {});
  assert.equal(all.total, 3);
  assert.equal(all.page, 1);
  assert.equal(all.limit, 20);
  const page = await f.service.list(f.user, { page: 2, limit: 1 });
  assert.equal(
    page.items[0]?.measuredAt.toISOString(),
    '2026-09-01T00:00:00.000Z',
  );
  assert.equal(page.totalPages, 3);
  const range = await f.service.list(f.user, {
    from: '2026-09-01T02:00:00+02:00',
    to: '2026-09-01T00:00:00Z',
  });
  assert.equal(range.total, 1);
  assert.equal(f.list.mock.calls[0]?.arguments[0], f.user);
  assert.deepEqual(await f.service.list(randomUUID(), {}), {
    items: [],
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
});

void test('measurement service rejects invalid ranges/pagination and identities', async (context) => {
  const { service, user } = await setup(context);
  for (const input of [
    { from: '2026-09-01T00:00:00' },
    { from: '2026-09-02T00:00:00Z', to: '2026-09-01T00:00:00Z' },
    { page: 0 },
    { limit: 101 },
    { page: 2147483648, limit: 100 },
    { page: '2' },
    { to: null },
  ])
    await assert.rejects(
      service.list(user, input as BodyMeasurementQueryInput),
      InvalidBodyMeasurementError,
    );
  await assert.rejects(
    service.getById(user, 'invalid'),
    InvalidBodyMeasurementError,
  );
  await assert.rejects(
    service.create('invalid', { weightKg: 80 }),
    InvalidBodyMeasurementError,
  );
});

void test('measurement PATCH validates the resulting state, preserves absent fields and clears nullable values', async (context) => {
  const f = await setup(context);
  const row = await f.service.create(f.user, {
    weightKg: 82,
    notes: 'original',
  });
  const added = await f.service.update(f.user, row.id, { waistCm: 84.33 });
  assert.equal(added.weightKg, 82);
  const cleared = await f.service.update(f.user, row.id, {
    weightKg: null,
    notes: null,
  });
  assert.equal(cleared.weightKg, null);
  assert.equal(cleared.notes, null);
  assert.equal(cleared.waistCm, 84.33);
  assert.equal(cleared.createdAt.getTime(), row.createdAt.getTime());
  assert.equal(cleared.measuredAt.getTime(), row.measuredAt.getTime());
  await assert.rejects(
    f.service.update(f.user, row.id, { waistCm: null }),
    InvalidBodyMeasurementError,
  );
  assert.equal((await f.service.getById(f.user, row.id)).waistCm, 84.33);
  await assert.rejects(
    f.service.update(f.user, row.id, {}),
    InvalidBodyMeasurementError,
  );
  await f.service.update(f.user, row.id, {
    measuredAt: '2026-08-01T00:00:00Z',
    notes: ' corrected ',
  });
  assert.equal((await f.service.getById(f.user, row.id)).notes, 'corrected');
  assert.equal(f.update.mock.calls[0]?.arguments[0], f.user);
});

void test('measurement ownership conceals foreign/missing details, updates and deletes; owned deletion removes the row', async (context) => {
  const { service, user } = await setup(context);
  const row = await service.create(user, { weightKg: 82 });
  const other = randomUUID();
  for (const id of [row.id, randomUUID()]) {
    await assert.rejects(
      service.getById(other, id),
      BodyMeasurementNotFoundError,
    );
    await assert.rejects(
      service.update(other, id, { weightKg: 83 }),
      BodyMeasurementNotFoundError,
    );
    await assert.rejects(
      service.remove(other, id),
      BodyMeasurementNotFoundError,
    );
  }
  await service.remove(user, row.id);
  await assert.rejects(
    service.getById(user, row.id),
    BodyMeasurementNotFoundError,
  );
  await assert.rejects(
    service.remove(user, row.id),
    BodyMeasurementNotFoundError,
  );
});

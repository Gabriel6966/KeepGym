import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { BodyMeasurementsRepository } from '../src/body-measurements/body-measurements.repository';
import { BodyMeasurementNotFoundError } from '../src/body-measurements/errors/body-measurement-not-found.error';
import { BodyMeasurementPersistenceError } from '../src/body-measurements/errors/body-measurement-persistence.error';
import { InvalidBodyMeasurementError } from '../src/body-measurements/errors/invalid-body-measurement.error';
import { measurementFixture } from './support/in-memory-body-measurements.repository';
import type { BodyMeasurementChanges } from '../src/body-measurements/body-measurements.types';

async function setup(context: TestContext) {
  const row = {
    ...measurementFixture(),
    weightKg: new Prisma.Decimal('82.25'),
  };
  const events: string[] = [];
  const create = context.mock.fn<
    (args: Prisma.BodyMeasurementCreateArgs) => Promise<typeof row>
  >(async () => row);
  const findFirst = context.mock.fn<
    (args: Prisma.BodyMeasurementFindFirstArgs) => Promise<typeof row>
  >(async () => {
    events.push('read');
    return row;
  });
  const findMany = context.mock.fn<
    (args: Prisma.BodyMeasurementFindManyArgs) => Promise<(typeof row)[]>
  >(async () => [row]);
  const count = context.mock.fn<
    (args: Prisma.BodyMeasurementCountArgs) => Promise<number>
  >(async () => 1);
  const update = context.mock.fn<
    (args: Prisma.BodyMeasurementUpdateArgs) => Promise<typeof row>
  >(async () => {
    events.push('write');
    return row;
  });
  const deleteMany = context.mock.fn<
    (args: Prisma.BodyMeasurementDeleteManyArgs) => Promise<{ count: number }>
  >(async () => ({ count: 1 }));
  const sql = context.mock.fn<(query: Prisma.Sql) => Promise<{ id: string }[]>>(
    async () => {
      events.push('lock');
      return [{ id: row.id }];
    },
  );
  const tx = {
    bodyMeasurement: { create, findFirst, findMany, count, update, deleteMany },
    $queryRaw: sql,
  };
  const transaction = context.mock.fn<
    (
      callback: (client: typeof tx) => Promise<unknown>,
      options: { isolationLevel: string },
    ) => Promise<unknown>
  >(async (callback) => callback(tx));
  const module = await Test.createTestingModule({
    providers: [
      BodyMeasurementsRepository,
      {
        provide: PrismaService,
        useValue: { ...tx, $transaction: transaction },
      },
    ],
  }).compile();
  context.after(() => module.close());
  return {
    repository: module.get(BodyMeasurementsRepository),
    row,
    events,
    create,
    findFirst,
    findMany,
    count,
    update,
    deleteMany,
    sql,
    transaction,
  };
}

void test('measurement repository writes allowlisted exact Decimal values and never accepts identity/timestamps from input', async (context) => {
  const f = await setup(context);
  await f.repository.create(f.row.userId, {
    weightKg: 82.25,
    bodyFatPercent: 15.75,
    waistCm: 84.33,
    notes: null,
    userId: randomUUID(),
    id: randomUUID(),
  } as BodyMeasurementChanges);
  const data = f.create.mock.calls[0]!.arguments[0].data;
  assert.equal(data.userId, f.row.userId);
  assert.equal(data.id, undefined);
  assert.ok(data.weightKg instanceof Prisma.Decimal);
  assert.equal(data.weightKg.toString(), '82.25');
  assert.equal(data.bodyFatPercent?.toString(), '15.75');
  assert.equal(data.waistCm?.toString(), '84.33');
  assert.equal(data.hipsCm, undefined);
  assert.equal(data.notes, null);
});

void test('measurement repository scopes list/count/detail/delete, inclusive dates and stable pagination in one snapshot', async (context) => {
  const f = await setup(context);
  const from = new Date('2026-08-01T00:00:00Z');
  const to = new Date('2026-09-01T00:00:00Z');
  await f.repository.findManyByUser(f.row.userId, {
    from,
    to,
    page: 2,
    limit: 10,
  });
  assert.deepEqual(f.findMany.mock.calls[0]?.arguments, [
    {
      where: { userId: f.row.userId, measuredAt: { gte: from, lte: to } },
      orderBy: [{ measuredAt: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 10,
    },
  ]);
  assert.deepEqual(
    f.count.mock.calls[0]?.arguments[0].where,
    f.findMany.mock.calls[0]?.arguments[0].where,
  );
  assert.equal(
    f.transaction.mock.calls[0]?.arguments[1].isolationLevel,
    'RepeatableRead',
  );
  await f.repository.findByIdAndUser(f.row.userId, f.row.id);
  await f.repository.deleteByIdAndUser(f.row.userId, f.row.id);
  assert.deepEqual(f.findFirst.mock.calls[0]?.arguments, [
    { where: { id: f.row.id, userId: f.row.userId } },
  ]);
  assert.deepEqual(
    f.deleteMany.mock.calls[0]?.arguments,
    f.findFirst.mock.calls[0]?.arguments,
  );
});

void test('measurement update locks scoped identifiers with parameters, reads latest state then validates before writing', async (context) => {
  const f = await setup(context);
  await f.repository.updateByIdAndUser(
    f.row.userId,
    f.row.id,
    { waistCm: 84.33 },
    (current) => {
      assert.equal(current.weightKg?.toString(), '82.25');
      f.events.push('validate');
    },
  );
  assert.deepEqual(f.events, ['lock', 'read', 'validate', 'write']);
  assert.equal(
    f.transaction.mock.calls[0]?.arguments[1].isolationLevel,
    'ReadCommitted',
  );
  const sql = f.sql.mock.calls[0]!.arguments[0];
  assert.deepEqual(sql.values, [f.row.id, f.row.userId]);
  assert.match(
    sql.text,
    /WHERE "id" = \$1::uuid AND "user_id" = \$2::uuid\s+FOR UPDATE/,
  );
  assert.equal(sql.text.includes(f.row.userId), false);
  assert.deepEqual(f.update.mock.calls[0]?.arguments[0].where, {
    id: f.row.id,
    userId: f.row.userId,
  });
  const changes = f.update.mock.calls[0]!.arguments[0].data;
  assert.equal(changes.weightKg, undefined);
  assert.equal(changes.waistCm?.toString(), '84.33');
});

void test('measurement missing lock/delete is 404; rejected resulting state never writes', async (context) => {
  const f = await setup(context);
  await assert.rejects(
    f.repository.updateByIdAndUser(
      f.row.userId,
      f.row.id,
      { weightKg: null },
      () => {
        throw new InvalidBodyMeasurementError();
      },
    ),
    InvalidBodyMeasurementError,
  );
  assert.equal(f.update.mock.calls.length, 0);
  f.sql.mock.mockImplementation(async () => []);
  await assert.rejects(
    f.repository.updateByIdAndUser(f.row.userId, f.row.id, {}, () =>
      assert.fail('must not validate missing row'),
    ),
    BodyMeasurementNotFoundError,
  );
  f.deleteMany.mock.mockImplementation(async () => ({ count: 0 }));
  await assert.rejects(
    f.repository.deleteByIdAndUser(f.row.userId, f.row.id),
    BodyMeasurementNotFoundError,
  );
});

void test('measurement persistence errors are sanitized; only own SQLSTATE 23514 constraints become invalid input', async (context) => {
  const f = await setup(context);
  for (const name of [
    'weight',
    'body_fat',
    'waist',
    'chest',
    'hips',
    'metric',
  ]) {
    const error = {
      cause: {
        originalCode: '23514',
        originalMessage: `violates check constraint "body_measurements_${name}_check"`,
      },
    };
    f.create.mock.mockImplementation(async () => {
      throw error;
    });
    await assert.rejects(
      f.repository.create(f.row.userId, {}),
      InvalidBodyMeasurementError,
    );
  }
  for (const error of [
    new Error('private SQL details'),
    { cause: { originalCode: '23514', originalMessage: 'other_check' } },
    {
      cause: {
        originalCode: '23503',
        originalMessage: '"body_measurements_metric_check"',
      },
    },
  ]) {
    f.create.mock.mockImplementation(async () => {
      throw error;
    });
    await assert.rejects(
      f.repository.create(f.row.userId, {}),
      BodyMeasurementPersistenceError,
    );
  }
  f.findMany.mock.mockImplementation(async () => {
    throw new Error('private');
  });
  await assert.rejects(
    f.repository.findManyByUser(f.row.userId, { page: 1, limit: 20 }),
    BodyMeasurementPersistenceError,
  );
});

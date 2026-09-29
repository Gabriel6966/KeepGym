import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { environmentConfig } from '../../src/config/environment.config';
import { configureHttp } from '../../src/http/configure-http';
import { PrismaService } from '../../src/prisma/prisma.service';
import { BodyMeasurementsRepository } from '../../src/body-measurements/body-measurements.repository';
import { BodyMeasurementsService } from '../../src/body-measurements/body-measurements.service';
import { InvalidBodyMeasurementError } from '../../src/body-measurements/errors/invalid-body-measurement.error';
import { BodyMeasurementPersistenceError } from '../../src/body-measurements/errors/body-measurement-persistence.error';
import { testEnvironment } from '../support/test-environment';

function object(value: unknown): Record<string, unknown> {
  assert.ok(
    typeof value === 'object' && value !== null && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  assert.equal(typeof value, 'string');
  return value as string;
}
function array(value: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(value));
  return value.map(object);
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return { promise, resolve };
}

// Opt-in PostgreSQL suite. Normal *.test.ts tests remain Docker independent.
void test('BodyMeasurement PostgreSQL HTTP: owned observations, exact decimals, atomic PATCH and cascades', async (context) => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(testEnvironment())
    .compile();
  const app = module.createNestApplication({ logger: false });
  const db = app.get(PrismaService);
  const repository = app.get(BodyMeasurementsRepository);
  const emails: string[] = [];
  const endpoint = '/body-measurements';
  let base: string;
  async function request(
    method: string,
    path: string,
    token?: string,
    body?: unknown,
    expected = 200,
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        origin: 'http://localhost:3000',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(response.status, expected, method + ' ' + path);
    if (expected === 204) {
      assert.equal(await response.text(), '');
      return {};
    }
    const result = object(await response.json());
    if (path.startsWith(endpoint)) {
      assert.equal(response.headers.get('set-cookie'), null);
      for (const field of [
        'userId',
        'passwordHash',
        'stack',
        'Prisma',
        'Decimal',
      ])
        assert.equal(JSON.stringify(result).includes('"' + field + '"'), false);
    }
    return result;
  }
  async function register() {
    const email = `gym014-${randomUUID()}@example.com`;
    assert.equal(await db.user.count({ where: { email } }), 0);
    emails.push(email);
    const result = await request(
      'POST',
      '/auth/register',
      undefined,
      { email, password: randomBytes(32).toString('base64url') },
      201,
    );
    return {
      id: string(object(result.user).id),
      token: string(result.accessToken),
      email,
    };
  }
  async function serviceFor(client: unknown) {
    const fixture = await Test.createTestingModule({
      providers: [
        BodyMeasurementsService,
        BodyMeasurementsRepository,
        { provide: PrismaService, useValue: client },
      ],
    }).compile();
    context.after(() => fixture.close());
    return fixture.get(BodyMeasurementsService);
  }
  try {
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    assert.deepEqual(await request('GET', '/health'), { status: 'ok' });
    const a = await register();
    const b = await register();
    const first = await request(
      'POST',
      endpoint,
      a.token,
      { measuredAt: '2026-08-01T00:00:00Z', weightKg: 85.5, waistCm: 90.25 },
      201,
    );
    const second = await request(
      'POST',
      endpoint,
      a.token,
      {
        measuredAt: '2026-09-01T00:00:00Z',
        weightKg: 83.25,
        bodyFatPercent: 16.5,
        waistCm: 87.75,
      },
      201,
    );
    const third = await request(
      'POST',
      endpoint,
      a.token,
      {
        measuredAt: '2026-09-20T00:00:00Z',
        weightKg: 82.4,
        chestCm: 102.3,
        hipsCm: 98.4,
      },
      201,
    );
    const foreign = await request(
      'POST',
      endpoint,
      b.token,
      { weightKg: 90 },
      201,
    );

    await context.test(
      'real API authenticates, creates single/multiple metrics and scopes inclusive historical pages',
      async () => {
        await request('POST', endpoint, undefined, { weightKg: 82 }, 401);
        const list = await request('GET', endpoint, a.token);
        assert.equal(list.total, 3);
        assert.deepEqual(list.items, [third, second, first]);
        const page = await request(
          'GET',
          endpoint + '?page=2&limit=1',
          a.token,
        );
        assert.deepEqual(page.items, [second]);
        assert.equal(page.totalPages, 3);
        const range = await request(
          'GET',
          endpoint +
            '?from=2026-09-01T02:00:00%2B02:00&to=2026-09-20T00:00:00Z',
          a.token,
        );
        assert.deepEqual(range.items, [third, second]);
        for (const method of ['GET', 'PATCH', 'DELETE'])
          await request(
            method,
            endpoint + '/' + string(first.id),
            b.token,
            method === 'PATCH' ? { weightKg: 80 } : undefined,
            404,
          );
        await request(
          'GET',
          endpoint + '/' + string(foreign.id),
          a.token,
          undefined,
          404,
        );
      },
    );

    await context.test(
      'PostgreSQL NUMERIC round-trips 82, 82.5, 82.25, 15.75 and 84.33 without Float artifacts',
      async () => {
        for (const weightKg of [82, 82.5, 82.25]) {
          const row = await request(
            'POST',
            endpoint,
            a.token,
            { weightKg, bodyFatPercent: 15.75, waistCm: 84.33 },
            201,
          );
          const id = string(row.id);
          assert.equal(row.weightKg, weightKg);
          assert.equal(row.bodyFatPercent, 15.75);
          assert.equal(row.waistCm, 84.33);
          const raw = await db.$queryRaw<
            { weight: string; fat: string; waist: string }[]
          >`
          SELECT weight_kg::text AS weight, body_fat_percent::text AS fat, waist_cm::text AS waist
          FROM body_measurements WHERE id = ${id}::uuid AND user_id = ${a.id}::uuid`;
          assert.deepEqual(raw, [
            { weight: weightKg.toFixed(2), fat: '15.75', waist: '84.33' },
          ]);
          await request('DELETE', endpoint + '/' + id, a.token, undefined, 204);
        }
      },
    );

    await context.test(
      'PATCH corrects historical time/metrics, distinguishes absent/null and rejects clearing the last metric',
      async () => {
        const id = string(first.id);
        const changed = await request('PATCH', endpoint + '/' + id, a.token, {
          weightKg: 84.33,
          waistCm: null,
          notes: '  correction  ',
          measuredAt: '2026-08-01T08:00:00+02:00',
        });
        assert.equal(changed.weightKg, 84.33);
        assert.equal(changed.waistCm, null);
        assert.equal(changed.notes, 'correction');
        assert.equal(changed.measuredAt, '2026-08-01T06:00:00.000Z');
        assert.equal(changed.createdAt, first.createdAt);
        await request(
          'PATCH',
          endpoint + '/' + id,
          a.token,
          { weightKg: null },
          400,
        );
        const kept = await request('GET', endpoint + '/' + id, a.token);
        assert.deepEqual(kept, changed);
        await request('PATCH', endpoint + '/' + id, a.token, {
          waistCm: 84.33,
        });
        const cleared = await request('PATCH', endpoint + '/' + id, a.token, {
          weightKg: null,
          notes: null,
        });
        assert.equal(cleared.weightKg, null);
        assert.equal(cleared.waistCm, 84.33);
        assert.equal(cleared.notes, null);
        await request('DELETE', endpoint + '/' + id, a.token, undefined, 204);
        await request('GET', endpoint + '/' + id, a.token, undefined, 404);
        await request('DELETE', endpoint + '/' + id, a.token, undefined, 404);
      },
    );

    await context.test(
      'SQL CHECKs reject all invalid ranges and empty observations without DTOs and are safely translated',
      async () => {
        const before = await db.bodyMeasurement.count({
          where: { userId: a.id },
        });
        for (const input of [
          {},
          { weightKg: null },
          { weightKg: 0 },
          { weightKg: -1 },
          { weightKg: 1000.01 },
          { bodyFatPercent: 0 },
          { bodyFatPercent: 100.01 },
          { waistCm: 0 },
          { waistCm: 500.01 },
          { chestCm: -1 },
          { chestCm: 500.01 },
          { hipsCm: 0 },
          { hipsCm: 500.01 },
        ])
          await assert.rejects(
            repository.create(a.id, input),
            InvalidBodyMeasurementError,
          );
        assert.equal(
          await db.bodyMeasurement.count({ where: { userId: a.id } }),
          before,
        );
        const constraints = await db.$queryRaw<{ name: string }[]>`
        SELECT conname AS name FROM pg_constraint WHERE conrelid = 'body_measurements'::regclass AND contype = 'c'`;
        assert.equal(constraints.length, 6);
      },
    );

    await context.test(
      'simultaneous HTTP PATCH clears cannot both succeed or leave an empty observation',
      async () => {
        const row = await request(
          'POST',
          endpoint,
          a.token,
          { weightKg: 82, waistCm: 84 },
          201,
        );
        const id = string(row.id);
        const results = await Promise.all(
          [{ weightKg: null }, { waistCm: null }].map(async (body) => {
            const response = await fetch(base + endpoint + '/' + id, {
              method: 'PATCH',
              headers: {
                authorization: 'Bearer ' + a.token,
                'content-type': 'application/json',
              },
              body: JSON.stringify(body),
            });
            await response.arrayBuffer();
            return response.status;
          }),
        );
        assert.deepEqual(results.sort(), [200, 400]);
        const stored = await db.bodyMeasurement.findUniqueOrThrow({
          where: { id },
        });
        assert.ok(stored.weightKg !== null || stored.waistCm !== null);
        assert.notEqual(stored.weightKg === null, stored.waistCm === null);
      },
    );

    await context.test(
      'a waiting PATCH validates the committed winner under a real row lock, then rolls back safely',
      async () => {
        const row = await repository.create(a.id, {
          weightKg: 82,
          waistCm: 84,
        });
        const locked = gate();
        const release = gate();
        const heldClient = db.$extends({
          query: {
            bodyMeasurement: {
              async findFirst({ args, query }) {
                const result = await query(args);
                if (args.where?.id === row.id) {
                  locked.resolve();
                  await release.promise;
                }
                return result;
              },
            },
          },
        });
        const held = await serviceFor(heldClient);
        const firstWrite = held.update(a.id, row.id, { weightKg: null });
        const settled = Promise.allSettled([firstWrite]);
        let waiting: Promise<Record<string, unknown>> | undefined;
        try {
          await Promise.race([
            locked.promise,
            firstWrite.then(() => {
              throw new Error('Expected locked row.');
            }),
          ]);
          waiting = request(
            'PATCH',
            endpoint + '/' + row.id,
            a.token,
            { waistCm: null },
            400,
          );
          // Attach a handler while observing pg_stat_activity, avoiding an unhandled rejection.
          const observed = Promise.allSettled([waiting]);
          let blocked = false;
          for (let attempt = 0; attempt < 40; attempt++) {
            const rows = await db.$queryRaw<{ count: number }[]>`
            SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query LIKE '%body_measurements%'`;
            if ((rows[0]?.count ?? 0) > 0) {
              blocked = true;
              break;
            }
            await delay(25);
          }
          assert.equal(
            blocked,
            true,
            'The competing PATCH must wait for the owned row.',
          );
          release.resolve();
          assert.equal((await observed)[0]?.status, 'fulfilled');
        } finally {
          release.resolve();
          await settled;
          await waiting;
        }
        assert.equal((await settled)[0]?.status, 'fulfilled');
        const stored = await db.bodyMeasurement.findUniqueOrThrow({
          where: { id: row.id },
        });
        assert.equal(stored.weightKg, null);
        assert.equal(stored.waistCm?.toNumber(), 84);
      },
    );

    await context.test(
      'failure after update rolls back values and updatedAt; subsequent corrections still work',
      async () => {
        const row = await repository.create(a.id, { weightKg: 82 });
        const failing = await serviceFor(
          db.$extends({
            query: {
              bodyMeasurement: {
                async update({ args, query }) {
                  const result = await query(args);
                  if (args.where.id === row.id)
                    throw new Error('Controlled rollback test');
                  return result;
                },
              },
            },
          }),
        );
        await assert.rejects(
          failing.update(a.id, row.id, { weightKg: 83 }),
          BodyMeasurementPersistenceError,
        );
        assert.deepEqual(
          await db.bodyMeasurement.findUnique({ where: { id: row.id } }),
          row,
        );
        await request('PATCH', endpoint + '/' + row.id, a.token, {
          weightKg: 83,
        });
      },
    );

    await context.test(
      'same timestamp is allowed, id DESC breaks ties, and API rejects invalid dates/query/decimal input',
      async () => {
        const time = '2026-09-01T00:00:00Z';
        const duplicate = await request(
          'POST',
          endpoint,
          a.token,
          { measuredAt: time, weightKg: 82 },
          201,
        );
        const filtered = await request(
          'GET',
          endpoint + '?from=' + time + '&to=' + time,
          a.token,
        );
        assert.equal(filtered.total, 2);
        const ids = array(filtered.items).map((row) => string(row.id));
        assert.deepEqual(
          ids,
          [string(second.id), string(duplicate.id)].sort().reverse(),
        );
        for (const body of [
          {},
          { weightKg: '82.4' },
          { weightKg: 82.123 },
          { weightKg: 82, measuredAt: '9999-01-01T00:00:00Z' },
        ])
          await request('POST', endpoint, a.token, body, 400);
        for (const query of [
          'from=2026-09-02T00:00:00Z&to=2026-09-01T00:00:00Z',
          'from=2026-09-01T00:00:00',
          'page=0',
          'limit=101',
          'userId=' + b.id,
        ])
          await request('GET', endpoint + '?' + query, a.token, undefined, 400);
      },
    );

    await context.test(
      'deleting the temporary User cascades only its observations; other user remains intact',
      async () => {
        assert.ok(
          (await db.bodyMeasurement.count({ where: { userId: a.id } })) > 0,
        );
        await db.user.delete({ where: { id: a.id, email: a.email } });
        assert.equal(
          await db.bodyMeasurement.count({ where: { userId: a.id } }),
          0,
        );
        assert.equal(
          await db.bodyMeasurement.count({ where: { userId: b.id } }),
          1,
        );
      },
    );
  } finally {
    try {
      const users = await db.user.findMany({
        where: { email: { in: emails } },
        select: { id: true, email: true },
      });
      for (const user of users) {
        await db.user.delete({ where: { id: user.id, email: user.email } });
        assert.equal(
          await db.bodyMeasurement.count({ where: { userId: user.id } }),
          0,
        );
      }
      assert.equal(
        await db.user.count({ where: { email: { in: emails } } }),
        0,
      );
    } finally {
      await app.close();
    }
  }
});

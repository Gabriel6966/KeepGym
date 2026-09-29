import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { AppModule } from '../../src/app.module';
import { environmentConfig } from '../../src/config/environment.config';
import { configureHttp } from '../../src/http/configure-http';
import { PrismaService } from '../../src/prisma/prisma.service';
import { BodyAnalyticsRepository } from '../../src/body-analytics/body-analytics.repository';
import { BodyAnalyticsService } from '../../src/body-analytics/body-analytics.service';
import { bodyMetrics } from '../../src/body-analytics/body-analytics.types';
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

// Opt-in real PostgreSQL/HTTP suite. Only the exact temporary users are removed.
void test('Body analytics PostgreSQL HTTP: partial metric sequences, Decimal, scoped ranges and fixed read-only queries', async (context) => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(testEnvironment())
    .compile();
  const app = module.createNestApplication({ logger: false });
  const db = app.get(PrismaService);
  const emails: string[] = [];
  const overview = '/body-analytics/overview';
  const timeline = '/body-analytics/timeline';
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
    const result = object(await response.json());
    if (path.startsWith('/body-analytics')) {
      assert.equal(response.headers.get('set-cookie'), null);
      for (const field of [
        'userId',
        'notes',
        'Prisma',
        'Decimal',
        'passwordHash',
        'stack',
      ])
        assert.equal(JSON.stringify(result).includes('"' + field + '"'), false);
    }
    return result;
  }
  async function register() {
    const email = `gym015-${randomUUID()}@example.com`;
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
    };
  }
  try {
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    assert.deepEqual(await request('GET', '/health'), { status: 'ok' });
    const a = await register();
    const b = await register();
    await context.test(
      'empty real data yields all null metrics and empty canonical timeline',
      async () => {
        const result = await request('GET', overview, a.token);
        for (const metric of bodyMetrics)
          assert.deepEqual(result[metric], {
            latest: null,
            previous: null,
            change: null,
          });
        assert.deepEqual(
          await request('GET', timeline + '?metric=weightKg', a.token),
          {
            metric: 'weightKg',
            unit: 'kg',
            items: [],
            page: 1,
            limit: 50,
            total: 0,
            totalPages: 0,
          },
        );
      },
    );
    const inputs = [
      { measuredAt: '2026-08-01T00:00:00Z', weightKg: 85.5, waistCm: 90.25 },
      {
        measuredAt: '2026-09-01T00:00:00Z',
        weightKg: 83.25,
        bodyFatPercent: 16.5,
        waistCm: 87.75,
      },
      { measuredAt: '2026-09-10T00:00:00Z', chestCm: 103 },
      {
        measuredAt: '2026-09-20T00:00:00Z',
        weightKg: 82.4,
        chestCm: 102.3,
        hipsCm: 98.4,
      },
      { measuredAt: '2026-09-25T00:00:00Z', waistCm: 84.5 },
    ];
    for (const input of inputs)
      await request('POST', '/body-measurements', a.token, input, 201);
    await request(
      'POST',
      '/body-measurements',
      b.token,
      {
        measuredAt: '2026-09-25T00:00:00Z',
        weightKg: 150,
        waistCm: 100,
        chestCm: 110,
        bodyFatPercent: 25,
        hipsCm: 120,
      },
      201,
    );
    const before = await db.bodyMeasurement.findMany({
      where: { userId: { in: [a.id, b.id] } },
      orderBy: { id: 'asc' },
    });

    await context.test(
      'overview independently selects partial observations: weight -0.85, waist -3.25, chest -0.70',
      async () => {
        const result = await request('GET', overview, a.token);
        assert.deepEqual(result.weightKg, {
          latest: { value: 82.4, measuredAt: '2026-09-20T00:00:00.000Z' },
          previous: { value: 83.25, measuredAt: '2026-09-01T00:00:00.000Z' },
          change: -0.85,
        });
        assert.deepEqual(result.waistCm, {
          latest: { value: 84.5, measuredAt: '2026-09-25T00:00:00.000Z' },
          previous: { value: 87.75, measuredAt: '2026-09-01T00:00:00.000Z' },
          change: -3.25,
        });
        assert.deepEqual(result.chestCm, {
          latest: { value: 102.3, measuredAt: '2026-09-20T00:00:00.000Z' },
          previous: { value: 103, measuredAt: '2026-09-10T00:00:00.000Z' },
          change: -0.7,
        });
        for (const [metric, value, date] of [
          ['bodyFatPercent', 16.5, '2026-09-01'],
          ['hipsCm', 98.4, '2026-09-20'],
        ] as const)
          assert.deepEqual(result[metric], {
            latest: { value, measuredAt: date + 'T00:00:00.000Z' },
            previous: null,
            change: null,
          });
        const raw = await db.$queryRaw<
          { weight: string }[]
        >`SELECT weight_kg::text AS weight FROM body_measurements WHERE user_id = ${a.id}::uuid AND weight_kg IS NOT NULL ORDER BY measured_at ASC, id ASC`;
        assert.deepEqual(
          raw.map((row) => row.weight),
          ['85.50', '83.25', '82.40'],
        );
      },
    );
    await context.test(
      'timeline omits nulls, orders ASC and paginates observations without altering global total',
      async () => {
        const result = await request(
          'GET',
          timeline + '?metric=weightKg',
          a.token,
        );
        assert.deepEqual(
          array(result.items).map((row) => row.value),
          [85.5, 83.25, 82.4],
        );
        assert.deepEqual(
          [
            result.page,
            result.limit,
            result.total,
            result.totalPages,
            result.unit,
          ],
          [1, 50, 3, 1, 'kg'],
        );
        const page = await request(
          'GET',
          timeline + '?metric=weightKg&page=2&limit=1',
          a.token,
        );
        assert.deepEqual(
          array(page.items).map((row) => row.value),
          [83.25],
        );
        assert.equal(page.total, 3);
        assert.equal(page.totalPages, 3);
        const beyond = await request(
          'GET',
          timeline + '?metric=weightKg&page=9&limit=1',
          a.token,
        );
        assert.deepEqual(beyond.items, []);
        assert.equal(beyond.total, 3);
        for (const [metric, expected, unit] of [
          ['bodyFatPercent', [16.5], 'percent'],
          ['waistCm', [90.25, 87.75, 84.5], 'cm'],
          ['chestCm', [103, 102.3], 'cm'],
          ['hipsCm', [98.4], 'cm'],
        ] as const) {
          const data = await request(
            'GET',
            timeline + '?metric=' + metric,
            a.token,
          );
          assert.deepEqual(
            array(data.items).map((row) => row.value),
            expected,
          );
          assert.equal(data.unit, unit);
        }
      },
    );
    await context.test(
      'inclusive range applies independently to latest, previous and timeline; nothing leaks outside bounds',
      async () => {
        const september = '?from=2026-09-01T00:00:00Z&to=2026-09-30T00:00:00Z';
        const data = await request(
          'GET',
          timeline + september + '&metric=weightKg',
          a.token,
        );
        assert.deepEqual(
          array(data.items).map((row) => row.value),
          [83.25, 82.4],
        );
        assert.equal(
          object((await request('GET', overview + september, a.token)).weightKg)
            .change,
          -0.85,
        );
        const range =
          '?from=2026-09-20T02:00:00%2B02:00&to=2026-09-25T00:00:00Z';
        const result = await request('GET', overview + range, a.token);
        for (const metric of bodyMetrics) {
          assert.equal(object(result[metric]).previous, null);
          assert.equal(object(result[metric]).change, null);
        }
        assert.equal(object(object(result.weightKg).latest).value, 82.4);
        assert.equal(object(result.bodyFatPercent).latest, null);
        assert.equal(
          (await request('GET', timeline + range + '&metric=weightKg', a.token))
            .total,
          1,
        );
        const noData = await request(
          'GET',
          overview + '?to=2026-07-01T00:00:00Z',
          a.token,
        );
        for (const metric of bodyMetrics)
          assert.equal(object(noData[metric]).latest, null);
      },
    );
    await context.test(
      'authentication, ownership and strict allowlisted input work against real persistence',
      async () => {
        await request('GET', overview, undefined, undefined, 401);
        await request(
          'GET',
          timeline + '?metric=weightKg',
          undefined,
          undefined,
          401,
        );
        const foreign = await request('GET', overview, b.token);
        assert.equal(object(object(foreign.weightKg).latest).value, 150);
        assert.equal(object(foreign.weightKg).previous, null);
        const rows = await request(
          'GET',
          timeline + '?metric=weightKg',
          b.token,
        );
        assert.deepEqual(
          array(rows.items).map((row) => row.value),
          [150],
        );
        for (const query of [
          'userId=' + b.id,
          'from=2026-09-01T00:00:00',
          'from=2026-09-20T00:00:00Z&to=2026-09-01T00:00:00Z',
        ])
          await request('GET', overview + '?' + query, a.token, undefined, 400);
        for (const query of [
          '',
          'metric=constructor',
          'metric=weightKg%3BSELECT',
          'metric=weightKg&page=0',
          'metric=weightKg&limit=201',
          'metric=weightKg&userId=' + b.id,
        ])
          await request('GET', timeline + '?' + query, a.token, undefined, 400);
      },
    );
    await context.test(
      'real SQL executes one overview statement and two timeline SELECTs, with bounded results and no other data sources',
      async () => {
        const connectionString = process.env.DATABASE_URL;
        assert.ok(connectionString);
        const traced = new PrismaClient({
          adapter: new PrismaPg({ connectionString }),
          log: [{ emit: 'event', level: 'query' }],
        });
        const statements: string[] = [];
        traced.$on('query', (event) => statements.push(event.query));
        const queryModule = await Test.createTestingModule({
          providers: [
            BodyAnalyticsRepository,
            { provide: PrismaService, useValue: traced },
          ],
        }).compile();
        const reads = queryModule.get(BodyAnalyticsRepository);
        try {
          async function queryCount(operation: () => Promise<unknown>) {
            statements.length = 0;
            await operation();
            const selects = statements.filter((sql) =>
              /^\s*\(*\s*SELECT\b/i.test(sql),
            );
            for (const sql of statements) {
              assert.doesNotMatch(
                sql,
                /(?:FROM|JOIN)\s+(?:"public"\.)?"?(?:users|profiles|exercises|workout_sessions|set_entries)"?\s/i,
              );
              assert.doesNotMatch(sql, /(?:INSERT|UPDATE|DELETE)\s/i);
            }
            return selects.length;
          }
          const overviewCount = await queryCount(async () => {
            const rows = await reads.getOverviewData(a.id, {});
            assert.equal(rows.length, 8);
            assert.ok(rows.length <= 10);
          });
          const small = await queryCount(() =>
            reads.findTimeline(a.id, { metric: 'weightKg', page: 1, limit: 1 }),
          );
          const large = await queryCount(() =>
            reads.findTimeline(a.id, {
              metric: 'weightKg',
              page: 1,
              limit: 200,
            }),
          );
          assert.equal(overviewCount, 1);
          assert.equal(small, 2);
          assert.equal(large, 2);
          context.diagnostic(
            `Body analytics SQL statements: overview=${overviewCount}; timeline=${small} SELECTs, independent of page size.`,
          );
        } finally {
          await queryModule.close();
          await traced.$disconnect();
        }
        assert.deepEqual(
          await db.bodyMeasurement.findMany({
            where: { userId: { in: [a.id, b.id] } },
            orderBy: { id: 'asc' },
          }),
          before,
        );
      },
    );
    await context.test(
      'same-time observations use deterministic UUID tie-breaks in both directions',
      async () => {
        const ids: string[] = [];
        for (const weightKg of [80.5, 82.25]) {
          const row = await request(
            'POST',
            '/body-measurements',
            a.token,
            { measuredAt: '2026-09-26T00:00:00Z', weightKg },
            201,
          );
          ids.push(string(row.id));
        }
        const range = '?from=2026-09-26T00:00:00Z&to=2026-09-26T00:00:00Z';
        const rows = array(
          (await request('GET', timeline + range + '&metric=weightKg', a.token))
            .items,
        );
        assert.deepEqual(
          rows.map((row) => row.measurementId),
          ids.sort(),
        );
        const result = object(
          (await request('GET', overview + range, a.token)).weightKg,
        );
        assert.equal(object(result.latest).value, rows[1]!.value);
        assert.equal(object(result.previous).value, rows[0]!.value);
      },
    );
    await context.test(
      'timeline count and items retain one RepeatableRead snapshot across a concurrent correction',
      async () => {
        const target = await db.bodyMeasurement.findFirstOrThrow({
          where: {
            userId: a.id,
            waistCm: { not: null },
            weightKg: { not: null },
          },
        });
        let corrected = false;
        const extended = db.$extends({
          query: {
            async $allOperations({ operation, args, query }) {
              const result: unknown = await query(args);
              if (!corrected && operation === '$queryRaw') {
                corrected = true;
                await db.bodyMeasurement.update({
                  where: { id: target.id, userId: a.id },
                  data: { waistCm: null },
                });
              }
              return result;
            },
          },
        });
        const queryModule = await Test.createTestingModule({
          providers: [
            BodyAnalyticsService,
            BodyAnalyticsRepository,
            { provide: PrismaService, useValue: extended },
          ],
        }).compile();
        try {
          const response = await queryModule
            .get(BodyAnalyticsService)
            .getTimeline(a.id, { metric: 'waistCm' });
          assert.equal(corrected, true);
          assert.equal(response.items.length, 3);
          assert.equal(response.total, 3);
          assert.equal(
            (await request('GET', timeline + '?metric=waistCm', a.token)).total,
            2,
          );
        } finally {
          await queryModule.close();
        }
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

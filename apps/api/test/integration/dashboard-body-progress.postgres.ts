import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../src/app.module';
import { bodyMetrics } from '../../src/body-analytics/body-analytics.types';
import { environmentConfig } from '../../src/config/environment.config';
import { PrismaClient } from '../../src/generated/prisma/client';
import { configureHttp } from '../../src/http/configure-http';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  dashboardInput,
  emptyDashboard,
  emptyBodyOverview,
} from '../support/dashboard-services';
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

void test('Dashboard body progress PostgreSQL HTTP: all-time partial sequences, ownership, canonical units and nine domain reads', async (context) => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString);
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: [{ emit: 'event', level: 'query' }],
  });
  const statements: string[] = [];
  db.$on('query', (event) => statements.push(event.query));
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(testEnvironment())
    .overrideProvider(PrismaService)
    .useValue(db)
    .compile();
  const app = module.createNestApplication({ logger: false });
  const emails: string[] = [],
    measurementIds: string[] = [];
  let base: string;
  async function request(
    path: string,
    token?: string,
    body?: unknown,
    expected = 200,
  ) {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        origin: 'http://localhost:3000',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(response.status, expected, path);
    const result = object(await response.json());
    if (path.startsWith('/dashboard/') || path.startsWith('/body-analytics/')) {
      assert.equal(response.headers.get('set-cookie'), null);
      for (const field of [
        'userId',
        'passwordHash',
        'Prisma',
        'Decimal',
        'stack',
        'BMI',
        'unitSystem',
        'recommendations',
      ])
        assert.equal(JSON.stringify(result).includes('"' + field + '"'), false);
    }
    return result;
  }
  async function register() {
    const email = `gym026-${randomUUID()}@example.com`;
    assert.equal(await db.user.count({ where: { email } }), 0);
    emails.push(email);
    const result = await request(
      '/auth/register',
      undefined,
      {
        email,
        password: randomBytes(32).toString('base64url'),
      },
      201,
    );
    return {
      id: string(object(result.user).id),
      token: string(result.accessToken),
    };
  }
  async function observed(path: string, token: string, expectedCount: number) {
    statements.length = 0;
    const result = await request(path, token);
    const selects = statements.filter((sql) =>
      /^\s*\(*\s*(?:WITH|SELECT)\b/i.test(sql),
    );
    assert.equal(selects.length, expectedCount);
    const bodyReads = selects.filter((sql) =>
      sql.includes('FROM body_measurements'),
    );
    assert.equal(bodyReads.length, 1);
    assert.equal(bodyReads[0]!.match(/LIMIT 2/g)?.length, 5);
    assert.doesNotMatch(bodyReads[0]!, /measured_at\s*(?:>=|<=)|JOIN|profiles/);
    for (const sql of selects)
      assert.doesNotMatch(
        sql,
        /(?:INSERT|UPDATE|DELETE)\s|(?:FROM|JOIN)\s+(?:"public"\.)?"?(?:profiles|users|exercises|workout_templates)"?\s/i,
      );
    return result;
  }
  const dashboard = (
    weekStart = dashboardInput.weekStart,
    timezone = dashboardInput.timezone,
  ) => '/dashboard/summary?' + new URLSearchParams({ weekStart, timezone });
  try {
    await db.$connect();
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    assert.deepEqual(await request('/health'), { status: 'ok' });
    const catalogBefore = await db.exercise.count();
    const a = await register(),
      b = await register();
    await context.test(
      'empty user has five null body metrics, zero training and unchanged auth/query contract',
      async () => {
        await request(dashboard(), undefined, undefined, 401);
        assert.deepEqual(
          await observed(dashboard(), a.token, 9),
          emptyDashboard(),
        );
        assert.deepEqual(
          await observed('/body-analytics/overview', a.token, 1),
          emptyBodyOverview(),
        );
        for (const query of [
          'userId=' + b.id,
          'from=2026-09-01',
          'metric=weightKg',
          'bodyFrom=2026-09-01',
        ])
          await request(dashboard() + '&' + query, a.token, undefined, 400);
      },
    );
    const inputs = [
      {
        measuredAt: '2026-09-01T08:00:00+02:00',
        weightKg: 80.5,
        bodyFatPercent: 20,
        chestCm: 100,
      },
      {
        measuredAt: '2026-09-10T08:00:00+02:00',
        bodyFatPercent: 19.5,
        waistCm: 85,
        hipsCm: 98,
      },
      {
        measuredAt: '2026-09-20T08:00:00+02:00',
        weightKg: 79.25,
        chestCm: 99.5,
      },
    ];
    for (const input of inputs) {
      const measurement = await request(
        '/body-measurements',
        a.token,
        input,
        201,
      );
      measurementIds.push(string(measurement.id));
    }
    const before = await db.bodyMeasurement.findMany({
      where: { userId: a.id },
      orderBy: { id: 'asc' },
    });
    const expected = {
      weightKg: {
        latest: { value: 79.25, measuredAt: '2026-09-20T06:00:00.000Z' },
        previous: { value: 80.5, measuredAt: '2026-09-01T06:00:00.000Z' },
        change: -1.25,
      },
      bodyFatPercent: {
        latest: { value: 19.5, measuredAt: '2026-09-10T06:00:00.000Z' },
        previous: { value: 20, measuredAt: '2026-09-01T06:00:00.000Z' },
        change: -0.5,
      },
      waistCm: {
        latest: { value: 85, measuredAt: '2026-09-10T06:00:00.000Z' },
        previous: null,
        change: null,
      },
      chestCm: {
        latest: { value: 99.5, measuredAt: '2026-09-20T06:00:00.000Z' },
        previous: { value: 100, measuredAt: '2026-09-01T06:00:00.000Z' },
        change: -0.5,
      },
      hipsCm: {
        latest: { value: 98, measuredAt: '2026-09-10T06:00:00.000Z' },
        previous: null,
        change: null,
      },
    };
    await context.test(
      'five metric-specific latest/previous sequences preserve exact changes and timestamps; direct overview equals dashboard',
      async () => {
        const overview = await observed('/body-analytics/overview', a.token, 1);
        assert.deepEqual(overview, expected);
        const result = await observed(dashboard(), a.token, 9);
        assert.deepEqual(result, {
          ...emptyDashboard(),
          bodyProgress: overview,
        });
        assert.deepEqual(result.bodyProgress, expected);
        assert.deepEqual(
          await observed(dashboard(), b.token, 9),
          emptyDashboard(),
        );
      },
    );
    await context.test(
      'newer foreign measurements and imperial Profile presentation never affect canonical body progress',
      async () => {
        const foreign = await request(
          '/body-measurements',
          b.token,
          {
            measuredAt: '2026-09-25T08:00:00+02:00',
            weightKg: 200,
            bodyFatPercent: 50,
            waistCm: 150,
            chestCm: 160,
            hipsCm: 170,
          },
          201,
        );
        measurementIds.push(string(foreign.id));
        await request(
          '/profile',
          a.token,
          { displayName: 'GYM-026 temporary', unitSystem: 'IMPERIAL' },
          201,
        );
        assert.deepEqual(
          (await observed(dashboard(), a.token, 9)).bodyProgress,
          expected,
        );
        const foreignOverview = await observed(
          '/body-analytics/overview',
          b.token,
          1,
        );
        for (const metric of bodyMetrics) {
          assert.equal(object(foreignOverview[metric]).previous, null);
          assert.equal(object(foreignOverview[metric]).change, null);
          assert.notDeepEqual(foreignOverview[metric], expected[metric]);
        }
        assert.deepEqual(
          (await observed(dashboard(), b.token, 9)).bodyProgress,
          foreignOverview,
        );
      },
    );
    await context.test(
      'future weeks and different calendar timezones retain identical all-time body progress',
      async () => {
        for (const timezone of ['UTC', 'America/New_York', 'Europe/Madrid']) {
          const result = await observed(
            dashboard('2099-01-05', timezone),
            a.token,
            9,
          );
          assert.deepEqual(result, {
            ...emptyDashboard({ weekStart: '2099-01-05', timezone }),
            bodyProgress: expected,
          });
        }
        assert.deepEqual(
          await observed('/body-analytics/overview', a.token, 1),
          expected,
        );
      },
    );
    await context.test(
      'existing overview range and all five chronological canonical timelines remain unchanged',
      async () => {
        const ranged = await request(
          '/body-analytics/overview?from=2026-09-20T06:00:00Z',
          a.token,
        );
        assert.equal(object(ranged.weightKg).previous, null);
        assert.equal(object(ranged.waistCm).latest, null);
        for (const [metric, values, unit] of [
          ['weightKg', [80.5, 79.25], 'kg'],
          ['bodyFatPercent', [20, 19.5], 'percent'],
          ['waistCm', [85], 'cm'],
          ['chestCm', [100, 99.5], 'cm'],
          ['hipsCm', [98], 'cm'],
        ] as const) {
          const timeline = await request(
            '/body-analytics/timeline?metric=' + metric,
            a.token,
          );
          assert.ok(Array.isArray(timeline.items));
          assert.deepEqual(
            timeline.items.map((item: unknown) => object(item).value),
            values,
          );
          assert.equal(timeline.unit, unit);
          assert.equal(timeline.total, values.length);
          assert.equal(timeline.page, 1);
          assert.equal(timeline.limit, 50);
        }
        assert.deepEqual(
          await db.bodyMeasurement.findMany({
            where: { userId: a.id },
            orderBy: { id: 'asc' },
          }),
          before,
        );
        assert.equal(await db.exercise.count(), catalogBefore);
        const applied = await db.$queryRaw<
          { count: bigint }[]
        >`SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
        assert.equal(applied[0]!.count, 8n);
        context.diagnostic(
          'Observed real HTTP domain SELECTs: BodyAnalytics overview=1; Dashboard=9 (auth/setup/transaction control excluded). No new persistence or per-metric round trips.',
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
      assert.equal(
        await db.bodyMeasurement.count({
          where: { id: { in: measurementIds } },
        }),
        0,
      );
    } finally {
      await app.close();
      await db.$disconnect();
    }
  }
});

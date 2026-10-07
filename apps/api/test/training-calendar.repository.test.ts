import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import type { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TrainingCalendarRepository } from '../src/training-calendar/training-calendar.repository';
import { TrainingCalendarPersistenceError } from '../src/training-calendar/errors/training-calendar-persistence.error';
import { calendarInput } from './support/in-memory-training-calendar.repository';
const query = { ...calendarInput, totalDays: 7 };
async function setup(context: TestContext) {
  const read = context.mock.fn<(sql: Prisma.Sql) => Promise<unknown[]>>(
    async () => [],
  );
  const module = await Test.createTestingModule({
    providers: [
      TrainingCalendarRepository,
      { provide: PrismaService, useValue: { $queryRaw: read } },
    ],
  }).compile();
  context.after(() => module.close());
  return { read, repository: module.get(TrainingCalendarRepository) };
}
void test('calendar SQL binds owner/date/zone, excludes unfinished sessions and uses local half-open midnights', async (context) => {
  const f = await setup(context),
    user = randomUUID();
  await f.repository.findDailyActivity(user, query);
  const sql = f.read.mock.calls[0]!.arguments[0];
  assert.deepEqual(sql.values, [
    query.fromDate,
    query.toDate,
    query.timezone,
    user,
  ]);
  assert.match(sql.text, /w.user_id = \$4::uuid AND w.status = 'COMPLETED'/);
  assert.match(
    sql.text,
    /w.started_at >= \(p.first_day::timestamp AT TIME ZONE p.zone\)/,
  );
  assert.match(
    sql.text,
    /w.started_at < \(\(p.last_day \+ 1\)::timestamp AT TIME ZONE p.zone\)/,
  );
  assert.doesNotMatch(
    sql.text,
    /INTERVAL|24 hours|ended_at >=|completed_at|created_at|updated_at|CANCELLED|IN_PROGRESS/i,
  );
});
void test('calendar SQL preaggregates sets by session before daily count and duration sums, preserving empty workouts', async (context) => {
  const f = await setup(context);
  await f.repository.findDailyActivity(randomUUID(), query);
  const sql = f.read.mock.calls[0]!.arguments[0].text;
  assert.match(sql, /LEFT JOIN workout_session_exercises/);
  assert.match(sql, /LEFT JOIN set_entries/);
  assert.match(sql, /COUNT\(s.id\) AS completed_sets/);
  assert.match(sql, /SUM\(s.load_kg \* s.reps\)/);
  assert.match(sql, /GROUP BY w.id, p.zone/);
  assert.match(sql, /COUNT\(\*\)::text AS "completedWorkouts"/);
  assert.match(sql, /SUM\(duration_seconds\)::text AS "totalDurationSeconds"/);
  assert.match(
    sql,
    /FROM session_activity GROUP BY local_date ORDER BY local_date ASC/,
  );
  assert.match(sql, /w.started_at AT TIME ZONE p.zone/);
});
void test('calendar SQL detects invalid historical intervals without filtering or replacing them', async (context) => {
  const f = await setup(context);
  await f.repository.findDailyActivity(randomUUID(), query);
  const sql = f.read.mock.calls[0]!.arguments[0].text;
  assert.match(sql, /w.ended_at IS NULL OR w.ended_at < w.started_at/);
  assert.match(sql, /COUNT\(\*\) FILTER \(WHERE invalid_duration\)/);
  assert.match(sql, /EXTRACT\(EPOCH FROM \(w.ended_at - w.started_at\)\)/);
  assert.doesNotMatch(
    sql,
    /ABS\(|NOW\(|CURRENT_TIMESTAMP|COALESCE\(w.ended_at|float|double precision/i,
  );
});
void test('calendar uses one query independent of day count and never concatenates hostile parameters', async (context) => {
  const f = await setup(context),
    hostile = "'; SELECT 1 --";
  await f.repository.findDailyActivity(hostile, {
    ...query,
    fromDate: hostile,
    toDate: hostile,
    timezone: hostile,
  });
  const sql = f.read.mock.calls[0]!.arguments[0];
  assert.deepEqual(sql.values, [hostile, hostile, hostile, hostile]);
  assert.equal(sql.text.includes(hostile), false);
  await f.repository.findDailyActivity(randomUUID(), {
    ...query,
    totalDays: 366,
  });
  assert.equal(f.read.mock.calls.length, 2);
});
void test('calendar persistence failures are sanitized rather than returned as all-zero days', async (context) => {
  const f = await setup(context);
  f.read.mock.mockImplementation(async () => {
    throw new Error('private SQL');
  });
  await assert.rejects(
    f.repository.findDailyActivity(randomUUID(), query),
    (error: unknown) =>
      error instanceof TrainingCalendarPersistenceError &&
      !error.message.includes('private') &&
      error.cause === undefined,
  );
});

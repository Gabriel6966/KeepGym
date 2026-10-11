import { randomUUID } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client';
import { historyFixture } from './in-memory-history.repository';
import { InMemoryAnalyticsRepository } from './in-memory-analytics.repository';

export function exerciseHighlightsFixture() {
  const owner = randomUUID(),
    other = randomUUID();
  const benchId = randomUUID(),
    squatId = randomUUID(),
    rowId = randomUUID();
  const repository = new InMemoryAnalyticsRepository([]);
  function add(
    exerciseId: string | null,
    date: string,
    sets: readonly (readonly [number, number])[],
    name = 'Performance snapshot',
    status: 'COMPLETED' | 'CANCELLED' | 'IN_PROGRESS' = 'COMPLETED',
    userId = owner,
  ) {
    const record = historyFixture().completed;
    record.userId = userId;
    record.session.startedAt = new Date(date + 'T10:00:00Z');
    record.session.endedAt =
      status === 'IN_PROGRESS' ? null : new Date(date + 'T11:00:00Z');
    record.session.status = status;
    const entry = record.session.exercises.find((e) => e.position === 1)!;
    record.session.exercises = [entry];
    entry.sourceExerciseId = exerciseId;
    entry.exerciseName = name;
    entry.exerciseSlug = 'snapshot-slug';
    entry.sets = sets.map(([load, reps], index) => ({
      id: randomUUID(),
      position: index + 1,
      loadKg: new Prisma.Decimal(load),
      reps,
      rpe: null,
      rir: null,
      completedAt: new Date(date + 'T10:30:00Z'),
    }));
    repository.records.push(record);
    return record;
  }
  const oldestBench = add(benchId, '2026-09-18', [[100, 5]], 'Old PR snapshot');
  const previousBench = add(
    benchId,
    '2026-09-19',
    [
      [75, 8],
      [75, 8],
    ],
    'Previous Bench snapshot',
  );
  const latestBench = add(
    benchId,
    '2026-09-20',
    [
      [80, 8],
      [80, 8],
      [0, 10],
    ],
    'Latest Bench snapshot',
  );
  const squat = add(
    squatId,
    '2026-09-10',
    [
      [100, 5],
      [100, 5],
    ],
    'Squat snapshot',
  );
  const row = add(rowId, '2026-09-01', [[70, 10]], 'Row snapshot');
  add(benchId, '2026-09-25', [], 'Zero-set snapshot');
  add(benchId, '2026-09-26', [[9000, 10]], 'Cancelled', 'CANCELLED');
  add(benchId, '2026-09-27', [[9000, 10]], 'Active', 'IN_PROGRESS');
  add(benchId, '2026-09-28', [[9000, 10]], 'Foreign', 'COMPLETED', other);
  add(null, '2026-09-29', [[9000, 10]], 'Null source');
  return {
    owner,
    other,
    benchId,
    squatId,
    rowId,
    repository,
    add,
    oldestBench,
    previousBench,
    latestBench,
    squat,
    row,
  };
}

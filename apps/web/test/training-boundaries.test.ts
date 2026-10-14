import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
void test('Training overview renders backend metrics without totals/averages/streak reconstruction or per-week requests', () => {
  for (const file of [
    'training-content.tsx',
    'training-overview.tsx',
    'training-query.ts',
  ]) {
    const source = readFileSync(resolve('src/features/progress', file), 'utf8');
    assert.doesNotMatch(
      source,
      /\.reduce\s*\(|\.sort\s*\(|calculate(?:Average|Streak|Consistency|Volume)|activeWeeks\s*=|completedWorkouts\s*\+=|totalVolumeKg\s*\+=|totalDurationSeconds\s*\/|\b(?:Recharts|Chart\.js|Epley|PrismaService)\b/,
    );
  }
  const overview = readFileSync(
    resolve('src/features/progress/training-overview.tsx'),
    'utf8',
  );
  for (const method of [
    'getWeeklyTraining',
    'getWeeklyConsistency',
    'getWeeklyDuration',
  ])
    assert.equal(
      (overview.match(new RegExp('apiClient\\.' + method + '\\(', 'g')) ?? [])
        .length,
      1,
    );
  assert.doesNotMatch(
    overview,
    /apiClient\.(?:getExercise|listWorkout|dashboard)/,
  );
  assert.match(overview, /<ProgressSelector\s*\/?>/);
});

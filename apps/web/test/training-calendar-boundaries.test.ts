import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
void test('Calendar has one month-keyed read; selection uses loaded days; History list links without Calendar fan-out', () => {
  const root = resolve('src/features/history'),
    source = readFileSync(resolve(root, 'calendar-client.tsx'), 'utf8'),
    list = readFileSync(resolve(root, 'history-list.tsx'), 'utf8');
  assert.equal(
    (source.match(/apiClient\.getTrainingCalendar\(/g) ?? []).length,
    1,
  );
  assert.match(source, /query \? JSON.stringify\(query\) : null/);
  assert.match(source, /onSelect=\{select\}/);
  assert.match(source, /data.days.find/);
  assert.match(source, /key=\{JSON.stringify\(query\)\}/);
  assert.match(source, /href="\/history"[^>]*>[\s\S]*?List view/);
  assert.match(list, /<CalendarViewLink/);
  assert.doesNotMatch(list, /getTrainingCalendar|training-calendar\/days/);
  assert.doesNotMatch(
    source,
    /apiClient\.(?:getWorkoutHistory|listWorkoutHistory|getDashboard|listCatalog)/,
  );
});
void test('calendar renders daily values without monthly sums, averages, streaks, score, instant redistribution or new clients', () => {
  const root = resolve('src/features/history');
  for (const file of readdirSync(root).filter((name) =>
    /^calendar[.-].*\.tsx?$/.test(name),
  )) {
    const source = readFileSync(resolve(root, file), 'utf8');
    assert.doesNotMatch(
      source,
      /\.reduce\s*\(|\.sort\s*\(|monthlyTotal|averageDuration|activeDayPercentage|intensityScore|trainingStreak|loadKg\s*\*|endedAt|startedAt|86400000|24\s*\*\s*60|window\.innerWidth|fetch\(/,
    );
  }
  const content = readFileSync(resolve(root, 'calendar-content.tsx'), 'utf8');
  assert.match(content, /day.completedWorkouts > 0/);
  assert.doesNotMatch(content, /day.completedSets > 0|day.totalVolumeKg > 0/);
});

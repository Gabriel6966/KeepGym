import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
void test('muscle feature never reconstructs attribution/totals/percentages/ranking from exercises or secondary muscles', () => {
  const root = resolve('src/features/progress');
  for (const file of readdirSync(root).filter((f) =>
    /^muscle[.-].*\.tsx?$/.test(f),
  )) {
    const source = readFileSync(resolve(root, file), 'utf8');
    assert.doesNotMatch(
      source,
      /secondaryMuscles|\.primaryMuscle|WorkoutSessionExercise|CatalogExercise|\.reduce\s*\(|\.sort\s*\(|calculateVolume|totalVolumeKg\s*\+=|totalSetsByMuscle|volumeShare|balanceScore|loadKg\s*\*|\/exercises\b/,
    );
  }
});
void test('muscle page has one range-keyed read; metric/filter never enter request identity; overview has link but no muscle read', () => {
  const root = resolve('src/features/progress'),
    feature = readFileSync(resolve(root, 'muscle-progress.tsx'), 'utf8'),
    overview = readFileSync(resolve(root, 'training-overview.tsx'), 'utf8');
  assert.equal(
    (feature.match(/apiClient\.getMuscleGroupWeeklyTrends\(/g) ?? []).length,
    1,
  );
  assert.match(feature, /query \? JSON.stringify\(query\) : null/);
  assert.doesNotMatch(
    feature,
    /apiClient\.(?:getExercise|listCatalog|getWeekly)/,
  );
  assert.match(overview, /<MuscleProgressLink/);
  assert.doesNotMatch(
    overview,
    /getMuscleGroupWeeklyTrends|training-trends\/muscle-groups/,
  );
});

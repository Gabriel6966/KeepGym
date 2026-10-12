import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDashboardSummary } from '../src/features/dashboard/dashboard.contract';
import {
  emptyDashboard,
  populatedDashboard,
} from './support/dashboard-fixture';

void test('full HTTP contract supports empty and partial observations without global measurement assumptions', () => {
  assert.equal(isDashboardSummary(emptyDashboard()), true);
  assert.equal(isDashboardSummary(populatedDashboard()), true);
  const data = populatedDashboard();
  data.bodyProgress.weightKg.change = -7.77;
  assert.equal(isDashboardSummary(data), true);
});
void test('malformed or incomplete composed payloads fail as a whole, not partially fabricated data', () => {
  for (const value of [
    null,
    [],
    {},
    { ...emptyDashboard(), muscleGroups: undefined },
    {
      ...emptyDashboard(),
      week: { ...emptyDashboard().week, completedSets: '3' },
    },
    { ...emptyDashboard(), bodyProgress: { weightKg: null } },
    {
      ...emptyDashboard(),
      muscleGroups: [
        {
          muscleGroup: 'UNKNOWN',
          completedWorkouts: 1,
          completedSets: 1,
          totalReps: 8,
          totalVolumeKg: 0,
        },
      ],
    },
  ])
    assert.equal(isDashboardSummary(value), false);
  const data = populatedDashboard();
  data.week.totalVolumeKg = NaN;
  assert.equal(isDashboardSummary(data), false);
  data.week.totalVolumeKg = 100;
  data.recentWorkouts[0]!.startedAt = 'ambiguous-date';
  assert.equal(isDashboardSummary(data), false);
});

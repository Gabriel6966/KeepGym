import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MuscleWeeksContent,
  MuscleProgressLink,
} from '../src/features/progress/muscle-content';
import { TrainingReadState } from '../src/features/progress/training-content';
import { trainingMetrics } from '../src/features/progress/training.types';
import { muscleWeeks, muscleRange } from './support/muscle-fixture';
for (const option of trainingMetrics)
  void test(
    'muscle ' +
      option.key +
      ' exact rows, sparse weeks/groups, backend order, per-week presentation scale',
    () => {
      const data = muscleWeeks(),
        html = renderToStaticMarkup(
          <MuscleWeeksContent
            data={data}
            metric={option.key}
            muscleGroup="ALL"
            locale="en-US"
          />,
        );
      assert.ok(html.indexOf('2026-09-21') < html.indexOf('2026-10-05'));
      assert.doesNotMatch(html, /2026-09-28/);
      assert.equal((html.match(/data-progress-muscle=/g) ?? []).length, 4);
      assert.ok(html.indexOf('CHEST') < html.indexOf('TRICEPS'));
      assert.ok(html.lastIndexOf('BACK') < html.lastIndexOf('CHEST'));
      for (const week of data.buckets)
        for (const row of week.muscleGroups)
          assert.ok(
            html.includes(
              `${option.label}: ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(row[option.key])} ${option.unit}`,
            ),
          );
      const widths = [...html.matchAll(/style="width:([^%]+)%"/g)].map((m) =>
        Number(m[1]),
      );
      assert.equal(widths.length, 4);
      assert.ok(widths.every((w) => Number.isFinite(w) && w >= 0 && w <= 100));
      assert.match(html, /aria-hidden="true"/);
      if (option.key === 'completedSets')
        assert.deepEqual(widths, [50, 100, (2 / 3) * 100, 100]);
      if (option.key === 'totalVolumeKg') assert.equal(widths[2], 0);
      assert.doesNotMatch(
        html,
        /rank|score|balanced|undertrained|<ol[^>]*list-decimal|100%<\/p>/i,
      );
    },
  );
void test('empty range differs from empty filter; all canonical rows stay absent rather than invented', () => {
  const data = muscleWeeks();
  assert.match(
    renderToStaticMarkup(
      <MuscleWeeksContent
        data={data}
        metric="completedSets"
        muscleGroup="CORE"
      />,
    ),
    /No activity for this muscle group in this range/,
  );
  data.buckets = [];
  assert.match(
    renderToStaticMarkup(
      <MuscleWeeksContent
        data={data}
        metric="completedSets"
        muscleGroup="CORE"
      />,
    ),
    /No muscle-group activity in this range/,
  );
});
void test('CHEST filter preserves values/order with no other groups and single-group zero volume is real', () => {
  const html = renderToStaticMarkup(
    <MuscleWeeksContent
      data={muscleWeeks()}
      metric="completedWorkouts"
      muscleGroup="CHEST"
    />,
  );
  assert.equal((html.match(/data-muscle-week=/g) ?? []).length, 2);
  assert.equal((html.match(/data-progress-muscle="CHEST"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /data-progress-muscle="BACK|TRICEPS/);
  assert.match(html, /1 workouts/);
  assert.match(html, /2 workouts/);
  const zero = renderToStaticMarkup(
    <MuscleWeeksContent
      data={muscleWeeks()}
      metric="totalVolumeKg"
      muscleGroup="BACK"
    />,
  );
  assert.match(zero, /0 kg/);
  assert.match(zero, /width:0%/);
  assert.equal((zero.match(/data-muscle-week=/g) ?? []).length, 1);
  assert.doesNotMatch(zero, /No activity|2026-09-21/);
});
void test('loading/error/Retry use shared accessible read state and never masquerade as empty data', () => {
  const render = (failed: boolean) =>
    renderToStaticMarkup(
      <TrainingReadState
        resource={{ data: null, failed, retry: () => undefined }}
        title="Muscle-group activity"
      >
        {() => null}
      </TrainingReadState>,
    );
  assert.match(render(false), /aria-busy="true"/);
  assert.match(render(false), /Loading muscle-group activity/);
  assert.match(render(true), /role="alert"/);
  assert.match(render(true), /Retry/);
  assert.doesNotMatch(render(true), /No muscle-group activity/);
});
void test('Progress CTA is an accessible range/metric-preserving deep link with no data fetch', () => {
  const html = renderToStaticMarkup(
    <MuscleProgressLink range={muscleRange} metric="totalVolumeKg" />,
  );
  assert.match(html, /Muscle group progress/);
  assert.match(
    html,
    /href="\/progress\/muscle-groups\?fromWeekStart=2026-09-21&amp;toWeekStart=2026-10-05&amp;metric=totalVolumeKg&amp;muscleGroup=ALL"/,
  );
});

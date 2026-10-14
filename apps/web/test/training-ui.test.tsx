import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  TrainingConsistencyContent,
  TrainingDurationBars,
  TrainingDurationSummary,
  TrainingReadState,
  TrainingTrendsContent,
  TrainingWeekForm,
} from '../src/features/progress/training-content';
import {
  durationMetrics,
  trainingMetrics,
} from '../src/features/progress/training.types';
import {
  weeklyTraining,
  weeklyConsistency,
  weeklyDuration,
  trainingRange,
} from './support/training-fixture';

void test('section loading/error/Retry are accessible and failures never become empty charts', () => {
  const read = (
    data: ReturnType<typeof weeklyTraining> | null,
    failed: boolean,
  ) =>
    renderToStaticMarkup(
      <TrainingReadState
        resource={{ data, failed, retry: () => undefined }}
        title="Training trends"
      >
        {(value) => (
          <TrainingTrendsContent
            data={value}
            metric="totalVolumeKg"
            locale="en-US"
          />
        )}
      </TrainingReadState>,
    );
  assert.match(read(null, false), /aria-busy="true"/);
  assert.match(read(null, false), /Loading training trends/);
  assert.match(read(null, true), /role="alert"/);
  assert.match(read(null, true), /Training trends unavailable/);
  assert.match(read(null, true), /Retry/);
  assert.doesNotMatch(
    read(null, true),
    /No training activity|data-training-week/,
  );
  assert.match(read(weeklyTraining(), false), /575.75 kg/);
});
for (const option of trainingMetrics)
  void test(
    'Training Trends ' +
      option.key +
      ' retains exact values and sparse ASC ordering with one scale',
    () => {
      const data = weeklyTraining(),
        html = renderToStaticMarkup(
          <TrainingTrendsContent
            data={data}
            metric={option.key}
            locale="en-US"
          />,
        );
      assert.ok(html.indexOf('2026-09-21') < html.indexOf('2026-10-05'));
      assert.ok(html.indexOf('2026-10-05') < html.indexOf('2026-10-12'));
      assert.doesNotMatch(html, /2026-09-28/);
      assert.equal((html.match(/data-training-week=/g) ?? []).length, 3);
      assert.match(html, /aria-hidden="true"/);
      assert.doesNotMatch(html, /NaN|Infinity|improving|score|recommend/);
      for (const b of data.buckets)
        assert.ok(
          html.includes(
            `${option.label}: ${new Intl.NumberFormat('en-US').format(b[option.key])} ${option.unit}`,
          ),
        );
      const widths = [...html.matchAll(/style="width:([^%]+)%"/g)].map((m) =>
        Number(m[1]),
      );
      assert.equal(widths.length, 3);
      assert.ok(widths.every((w) => w >= 0 && w <= 100));
      assert.ok(widths.includes(100));
      if (option.key === 'totalVolumeKg') assert.ok(widths.includes(0));
    },
  );
void test('Training Trends handles empty, one bodyweight-only bucket and zeros without new range totals', () => {
  const data = weeklyTraining();
  data.buckets = [];
  assert.match(
    renderToStaticMarkup(
      <TrainingTrendsContent data={data} metric="completedSets" />,
    ),
    /No training activity in this range/,
  );
  data.buckets = [
    {
      weekStart: '2026-10-05',
      completedWorkouts: 1,
      completedSets: 2,
      totalReps: 16,
      totalVolumeKg: 0,
    },
  ];
  const html = renderToStaticMarkup(
    <TrainingTrendsContent data={data} metric="totalVolumeKg" />,
  );
  assert.match(html, /0 kg/);
  assert.match(html, /width:0%/);
  assert.doesNotMatch(html, /total workouts|total range volume/i);
});
void test('Consistency displays every backend metric, distinct ending/longest and no percentage reconstructed from sparse trends', () => {
  const data = weeklyConsistency();
  data.totalWeeks = 12;
  data.activeWeeks = 7;
  data.longestWeeklyStreak = 5;
  data.endingWeeklyStreak = 2;
  const html = renderToStaticMarkup(
    <TrainingConsistencyContent data={data} locale="en-US" />,
  );
  for (const label of [
    'Total weeks',
    'Completed workouts',
    'Active days',
    'Active weeks',
    'Longest weekly streak',
    'Ending weekly streak',
  ])
    assert.ok(html.includes(label));
  assert.match(html, />Active weeks<\/dt><dd[^>]*>7/);
  assert.match(html, />Longest weekly streak<\/dt><dd[^>]*>5/);
  assert.match(html, />Ending weekly streak<\/dt><dd[^>]*>2/);
  assert.doesNotMatch(html, /%|Current streak|score|adherence/i);
  const empty = {
    ...data,
    completedWorkouts: 0,
    activeDays: 0,
    activeWeeks: 0,
    longestWeeklyStreak: 0,
    endingWeeklyStreak: 0,
  };
  const zero = renderToStaticMarkup(
    <TrainingConsistencyContent data={empty} />,
  );
  assert.equal((zero.match(/>0<\/dd>/g) ?? []).length, 5);
  assert.match(zero, />12<\/dd>/);
});
void test('Duration summary uses backend weighted average with exact millisecond text, never a locally computed quotient', () => {
  const data = weeklyDuration();
  data.summary.averageDurationSeconds = 987.125;
  const html = renderToStaticMarkup(
    <TrainingDurationSummary data={data} locale="en-US" />,
  );
  assert.match(html, /2h 35m/);
  assert.match(html, /9,300.5 s/);
  assert.match(html, /987.125 s/);
  assert.doesNotMatch(html, /2,325.125/);
  data.summary = {
    completedWorkouts: 0,
    totalDurationSeconds: 0,
    averageDurationSeconds: null,
  };
  data.buckets = [];
  const empty = renderToStaticMarkup(<TrainingDurationSummary data={data} />);
  assert.match(empty, />Average workout duration<\/dt><dd[^>]*>—/);
  assert.match(empty, /0s/);
});
for (const option of durationMetrics)
  void test(
    'Duration ' +
      option.key +
      ' renders only sparse backend weekly values in chronological order',
    () => {
      const data = weeklyDuration(),
        html = renderToStaticMarkup(
          <TrainingDurationBars
            data={data}
            metric={option.key}
            locale="en-US"
          />,
        );
      assert.ok(html.indexOf('2026-09-21') < html.indexOf('2026-10-05'));
      assert.doesNotMatch(html, /2026-09-28/);
      for (const b of data.buckets)
        assert.ok(
          html.includes(
            new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(
              b[option.key],
            ) + ' s',
          ),
        );
      assert.equal((html.match(/data-training-week=/g) ?? []).length, 3);
      assert.match(html, /aria-hidden="true"/);
      data.buckets = [];
      assert.match(
        renderToStaticMarkup(
          <TrainingDurationBars data={data} metric={option.key} />,
        ),
        /No completed workout durations in this range/,
      );
    },
  );
void test('zero-duration completed bucket is activity with a zero bar, not missing or filtered', () => {
  const data = weeklyDuration();
  data.buckets = [
    {
      weekStart: '2026-10-12',
      completedWorkouts: 1,
      totalDurationSeconds: 0,
      averageDurationSeconds: 0,
    },
  ];
  const html = renderToStaticMarkup(
    <TrainingDurationBars data={data} metric="averageDurationSeconds" />,
  );
  assert.match(html, /0s \(0 s\)/);
  assert.match(html, /width:0%/);
  assert.doesNotMatch(html, /No completed/);
});
void test('week controls expose real labels, DATE-only Mondays and inclusive/shared descriptions', () => {
  const html = renderToStaticMarkup(
    <TrainingWeekForm
      range={trainingRange}
      timezone="Europe/Madrid"
      onApply={() => undefined}
    />,
  );
  assert.match(html, /From week \(Monday\)/);
  assert.match(html, /To week \(Monday\)/);
  assert.match(html, /value="2026-09-21"/);
  assert.match(html, /value="2026-10-12"/);
  assert.match(html, /Both Mondays are included/);
  assert.match(html, /Apply weeks/);
  assert.match(html, /aria-describedby="training-range-help"/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProgressExerciseCards } from '../src/features/progress/progress-selector';
import {
  ProgressSummary,
  ProgressRecords,
  ProgressPerformances,
} from '../src/features/progress/progress-content';
import {
  ProgressWeeklyBars,
  ProgressRangeForm,
} from '../src/features/progress/progress-trends';
import { trendMetrics } from '../src/features/progress/progress.types';
import { DashboardContent } from '../src/features/dashboard/dashboard-content';
import { HistoryDetailContent } from '../src/features/history/history-content';
import {
  WorkoutLoading,
  WorkoutError,
} from '../src/features/workout/workout.ui';
import { catalogFixture } from './support/templates-fixture';
import { populatedDashboard } from './support/dashboard-fixture';
import { historyDetail, cancelledHistory } from './support/history-fixture';
import {
  exerciseAnalytics,
  exerciseRecords,
  exerciseTrends,
  exerciseId,
  occurrenceId,
  templateEntryId,
  setId,
  sessionId,
} from './support/progress-fixture';

void test('selector empty and ordered catalog cards have source links and only available metadata', () => {
  assert.match(
    renderToStaticMarkup(<ProgressExerciseCards items={[]} />),
    /No exercises match this search/,
  );
  const html = renderToStaticMarkup(
    <ProgressExerciseCards
      items={[
        catalogFixture(exerciseId, 'Z First'),
        catalogFixture('other-id', 'A Second'),
      ]}
    />,
  );
  assert.ok(html.indexOf('Z First') < html.indexOf('A Second'));
  assert.match(
    html,
    new RegExp('href="/progress/exercises/' + exerciseId + '"'),
  );
  assert.match(html, /CHEST/);
  assert.match(html, /BARBELL/);
  assert.doesNotMatch(html, /instructions|analytics\/|userId/);
});
void test('summary uses backend aggregate names, snapshot set/context and History links', () => {
  const data = exerciseAnalytics();
  const html = renderToStaticMarkup(
    <ProgressSummary analytics={data} timezone="UTC" locale="en-US" />,
  );
  for (const text of [
    'Completed occurrences',
    'Recorded sets',
    'Total reps',
    'Total volume',
    'Heaviest set',
    'Best estimated 1RM set',
    '100 kg',
    '116.67 kg',
    'Push Original',
  ])
    assert.ok(html.includes(text), text);
  assert.match(html, new RegExp('href="/history/' + sessionId + '"'));
  assert.doesNotMatch(html, /href="\/history\/(?:2222|4444)/);
});
void test('zero-set analytics occurrences remain truthful with null max metrics and no manufactured candidate', () => {
  const data = exerciseAnalytics();
  data.summary = {
    sessions: 1,
    sets: 0,
    reps: 0,
    totalVolumeKg: 0,
    maxLoadKg: null,
    maxEstimated1RMKg: null,
  };
  data.heaviestSet = null;
  data.bestEstimated1RMSet = null;
  const html = renderToStaticMarkup(
    <ProgressSummary analytics={data} timezone="UTC" locale="en-US" />,
  );
  assert.match(html, /No completed set performance yet/);
  assert.match(html, /0 kg/);
  assert.match(html, />Max load<\/dt><dd[^>]*>—/);
  assert.doesNotMatch(html, /href="\/history/);
});
void test('summary candidate backend e1RM value is never recomputed from load/reps', () => {
  const data = exerciseAnalytics();
  assert.ok(data.bestEstimated1RMSet);
  data.bestEstimated1RMSet.estimated1RMKg = 987.65;
  const html = renderToStaticMarkup(
    <ProgressSummary analytics={data} timezone="UTC" locale="en-US" />,
  );
  assert.match(html, /987\.65 kg/);
});
void test('current Records preserve explicit first holder, achievedAt, load/reps and workout ID', () => {
  const records = exerciseRecords();
  assert.ok(records.maxLoadRecord);
  records.maxLoadRecord.valueKg = 123.45;
  const html = renderToStaticMarkup(
    <ProgressRecords records={records} timezone="UTC" locale="en-US" />,
  );
  assert.match(html, /123\.45 kg/);
  assert.match(html, /Holder: 100 kg/);
  assert.match(html, /First achievement workout/);
  assert.match(html, /First achieved/);
  assert.match(html, /dateTime="2026-09-01T08:00:00Z"/);
  assert.match(html, /data-progress-record="MAX_LOAD"/);
  assert.match(html, /data-progress-record="ESTIMATED_1RM"/);
  assert.doesNotMatch(html, /PR History|New PR|Latest achievement/);
});
void test('Records empty is empty rather than bodyweight PR=0; no frontend PR creation', () => {
  const html = renderToStaticMarkup(
    <ProgressRecords
      records={{
        exercise: null,
        maxLoadRecord: null,
        estimated1RMRecord: null,
      }}
      timezone="UTC"
    />,
  );
  assert.match(html, /No eligible current records/);
  assert.doesNotMatch(html, /0 kg|data-progress-record/);
});
for (const metric of trendMetrics)
  void test(
    'weekly ' +
      metric.key +
      ' preserves sparse dates and exact single-unit values',
    () => {
      const data = exerciseTrends(),
        before = structuredClone(data),
        html = renderToStaticMarkup(
          <ProgressWeeklyBars
            trends={data}
            metric={metric.key}
            locale="en-US"
          />,
        );
      assert.deepEqual(
        [...html.matchAll(/data-progress-week="([^"]+)"/g)].map((m) => m[1]),
        ['2026-08-31', '2026-09-14', '2026-10-05'],
      );
      assert.ok(html.includes(metric.label));
      assert.doesNotMatch(html, /data-progress-week="2026-09-07"|NaN|Infinity/);
      assert.deepEqual(data, before);
      if (metric.key === 'maxEstimated1RMKg') {
        assert.equal((html.match(/data-visual-bar/g) ?? []).length, 1);
        assert.match(html, /101\.33 kg/);
        assert.match(html, /Max estimated 1RM: —/);
      } else assert.equal((html.match(/data-visual-bar/g) ?? []).length, 3);
    },
  );
void test('bodyweight weekly zero load/volume keeps a real zero-width bar, not missing data', () => {
  const data = exerciseTrends();
  for (const metric of ['maxLoadKg', 'totalVolumeKg'] as const) {
    const html = renderToStaticMarkup(
      <ProgressWeeklyBars trends={data} metric={metric} locale="en-US" />,
    );
    assert.match(html, /0 kg/);
    assert.match(html, /style="width:0%"/);
    assert.doesNotMatch(html, /: —/);
  }
});
void test('weekly empty range explicitly does not claim never trained', () => {
  const html = renderToStaticMarkup(
    <ProgressWeeklyBars
      trends={{ ...exerciseTrends(), exercise: null, buckets: [] }}
      metric="totalVolumeKg"
    />,
  );
  assert.match(html, /No exercise activity in this range/);
  assert.doesNotMatch(html, /never|data-visual-bar/);
});
void test('DATE labels use received Monday, SSR is deterministic and chart is decorative', () => {
  const first = renderToStaticMarkup(
      <ProgressWeeklyBars
        trends={exerciseTrends()}
        metric="completedSets"
        locale="en-US"
      />,
    ),
    second = renderToStaticMarkup(
      <ProgressWeeklyBars
        trends={exerciseTrends()}
        metric="completedSets"
        locale="en-US"
      />,
    );
  assert.equal(first, second);
  assert.match(first, /Week of <time dateTime="2026-10-05">Oct 5, 2026/);
  assert.match(first, /aria-hidden="true" data-visual-bar/);
  assert.doesNotMatch(first, /role="img"|<canvas|<svg/);
});
void test('range form labels retain DATE-only strings and do not send timestamps/ownership as fields', () => {
  const html = renderToStaticMarkup(
    <ProgressRangeForm
      range={{ fromDate: '2026-09-01', toDate: '2026-10-13' }}
      timezone="UTC"
      onApply={() => undefined}
    />,
  );
  assert.match(html, /From date/);
  assert.match(html, /To date/);
  assert.match(html, /value="2026-09-01"/);
  assert.match(html, /Apply range/);
  assert.doesNotMatch(html, /userId|type="datetime/);
});
void test('performance cards preserve backend order, snapshot names, supplied totals and sets in order', () => {
  const data = exerciseAnalytics();
  const original = data.performances[0]!;
  data.performances = [
    { ...original, sessionName: 'Z Newest', volumeKg: 4321.5 },
    { ...original, sessionExerciseId: 'older-entry', sessionName: 'A Older' },
  ];
  const html = renderToStaticMarkup(
    <ProgressPerformances analytics={data} timezone="UTC" locale="en-US" />,
  );
  assert.ok(html.indexOf('Z Newest') < html.indexOf('A Older'));
  assert.match(html, /Historical Bench/);
  assert.match(html, /4,321\.5 kg/);
  assert.match(html, /Recorded sets/);
  assert.match(html, /Estimated 1RM/);
  assert.match(html, />RPE<\/dt><dd[^>]*>—/);
  assert.match(html, />RIR<\/dt><dd[^>]*>—/);
  assert.doesNotMatch(
    html,
    /Add set|Edit|Delete|Complete workout|Cancel workout/,
  );
});
void test('performance zero load and null e1RM are present; zero-set occurrence remains visible', () => {
  const data = exerciseAnalytics(),
    row = data.performances[0]!;
  row.maxLoadKg = 0;
  row.maxEstimated1RMKg = null;
  row.volumeKg = 0;
  row.sets[0] = { ...row.sets[0]!, loadKg: 0, estimated1RMKg: null };
  const html = renderToStaticMarkup(
    <ProgressPerformances analytics={data} timezone="UTC" locale="en-US" />,
  );
  assert.match(html, /0 kg/);
  assert.match(html, />Max estimated 1RM<\/dt><dd[^>]*>—/);
  row.sets = [];
  const noSets = renderToStaticMarkup(
    <ProgressPerformances analytics={data} timezone="UTC" />,
  );
  assert.match(noSets, /Push Original/);
  assert.match(noSets, /No sets recorded/);
});
void test('Dashboard highlights link only source Exercise id without altering factual blocks', () => {
  const data = populatedDashboard();
  data.exerciseHighlights[0]!.exercise.sourceExerciseId = exerciseId;
  const html = renderToStaticMarkup(
    <DashboardContent summary={data} locale="en-US" />,
  );
  assert.match(
    html,
    new RegExp('href="/progress/exercises/' + exerciseId + '"'),
  );
  for (const id of [occurrenceId, templateEntryId, setId])
    assert.doesNotMatch(html, new RegExp('/progress/exercises/' + id));
  assert.match(html, /101\.33 kg/);
});
void test('History source identity link is distinct from occurrence/template/set ids; null source has no link', () => {
  const data = historyDetail(),
    row = data.exercises[0]!;
  row.id = occurrenceId;
  row.exercise.sourceExerciseId = exerciseId;
  row.sets[0]!.id = setId;
  const html = renderToStaticMarkup(<HistoryDetailContent workout={data} />);
  assert.match(
    html,
    new RegExp('href="/progress/exercises/' + exerciseId + '"'),
  );
  assert.doesNotMatch(html, new RegExp('/progress/exercises/' + occurrenceId));
  const absent = renderToStaticMarkup(
    <HistoryDetailContent workout={cancelledHistory()} />,
  );
  assert.doesNotMatch(absent, /href="\/progress\/exercises/);
  assert.match(absent, /Historical Bench/);
});
void test('GET loading/error uses existing accessible states and Retry instead of empty success', () => {
  assert.match(
    renderToStaticMarkup(<WorkoutLoading label="Loading weekly trends..." />),
    /aria-busy="true"/,
  );
  const html = renderToStaticMarkup(
    <WorkoutError
      title="Weekly trends unavailable"
      onRetry={() => undefined}
    />,
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /Retry/);
  assert.doesNotMatch(html, /No exercise activity|SQL|Prisma/);
});

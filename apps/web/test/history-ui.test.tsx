import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  HistoryCards,
  HistoryDetailContent,
  HistoryTime,
} from '../src/features/history/history-content';
import {
  HistoryFilters,
  HistoryPagination,
} from '../src/features/history/history-list';
import {
  WorkoutLoading,
  WorkoutError,
} from '../src/features/workout/workout.ui';
import { WorkoutSessionContent } from '../src/features/workout/workout-session';
import { DashboardContent } from '../src/features/dashboard/dashboard-content';
import {
  historyDetail,
  historyPage,
  historySummary,
  cancelledHistory,
} from './support/history-fixture';
import { populatedDashboard } from './support/dashboard-fixture';

void test('empty History and filtered empty states are distinct, with Workout CTA only for unfiltered account', () => {
  const empty = renderToStaticMarkup(
      <HistoryCards items={[]} filtered={false} />,
    ),
    filtered = renderToStaticMarkup(<HistoryCards items={[]} filtered />);
  assert.match(empty, /No workout history yet/);
  assert.match(empty, /href="\/workout"/);
  assert.match(filtered, /No workouts match these filters/);
  assert.doesNotMatch(filtered, /Start a workout/);
});
void test('History list preserves received ordering and factual Completed/Cancelled card metadata without N+1', () => {
  const first = {
      ...historySummary(),
      id: 'first',
      name: 'Z first',
      status: 'CANCELLED' as const,
    },
    second = { ...historySummary(), id: 'second', name: 'A second' };
  const html = renderToStaticMarkup(
    <HistoryCards items={[first, second]} filtered={false} />,
  );
  assert.ok(html.indexOf('Z first') < html.indexOf('A second'));
  for (const label of [
    'Completed',
    'Cancelled',
    'Started',
    'Ended',
    'Exercises',
    'Recorded sets',
  ])
    assert.ok(html.includes(label));
  assert.match(html, /href="\/history\/first"/);
  assert.doesNotMatch(html, /volume|duration|estimated|failed/);
});
void test('filters expose only backend status/search/zoned timestamps, with accessible labels and no IN_PROGRESS', () => {
  const html = renderToStaticMarkup(
    <HistoryFilters
      query={{
        page: 2,
        q: 'push',
        status: 'CANCELLED',
        from: '2026-10-12T00:00:00Z',
      }}
      onApply={() => undefined}
    />,
  );
  for (const field of ['q', 'status', 'from', 'to'])
    assert.ok(html.includes('name="' + field + '"'));
  assert.match(html, /RFC3339/);
  assert.match(html, /Apply filters/);
  assert.match(html, /Clear filters/);
  assert.doesNotMatch(html, /IN_PROGRESS|muscle|PR filter/);
});
void test('pagination renders bounded Previous/Next using response page totals and never downloads all pages', () => {
  const first = renderToStaticMarkup(
      <HistoryPagination
        data={{ ...historyPage(), total: 21, totalPages: 2 }}
        onPage={() => undefined}
      />,
    ),
    last = renderToStaticMarkup(
      <HistoryPagination
        data={{ ...historyPage(), page: 2, total: 21, totalPages: 2 }}
        onPage={() => undefined}
      />,
    );
  assert.match(first, /<button[^>]*disabled[^>]*>Previous workouts/);
  assert.match(last, /<button[^>]*disabled[^>]*>Next workouts/);
  assert.match(last, /Page 2/);
});
for (const status of ['COMPLETED', 'CANCELLED'] as const)
  void test(
    'History ' +
      status +
      ' detail is exclusively read-only with actual persisted sets',
    () => {
      const detail = { ...cancelledHistory(), status },
        html = renderToStaticMarkup(<HistoryDetailContent workout={detail} />);
      assert.ok(
        html.includes(
          status === 'COMPLETED' ? 'Completed workout' : 'Cancelled workout',
        ),
      );
      assert.match(html, /Set 1/);
      assert.match(html, /Set 2/);
      assert.match(html, /0 kg/);
      assert.match(html, /RPE/);
      assert.match(html, /RIR/);
      assert.match(html, /—/);
      assert.doesNotMatch(
        html,
        /<form|<button|Add set|Edit|Delete|Complete workout|Cancel workout/,
      );
      assert.match(html, /Back to History/);
    },
  );
void test('detail renders historical name/exercise/planning even with null source identity, not mutable Template/Exercise data', () => {
  const detail = cancelledHistory(),
    before = structuredClone(detail),
    html = renderToStaticMarkup(<HistoryDetailContent workout={detail} />);
  for (const label of [
    'Push Original',
    'Historical Bench',
    'Historical planning only',
    'Historical workout notes',
    '3 sets',
    '8–10 reps',
    '90s rest',
    'CHEST',
    'BARBELL',
    'HORIZONTAL PUSH',
  ])
    assert.ok(html.includes(label));
  assert.doesNotMatch(
    html,
    /Push Renamed|Bench New Name|sourceTemplateId|isActive/,
  );
  assert.deepEqual(detail, before);
});
void test('zero-exercise and zero-set history remain visible; absent endedAt/RPE/RIR never becomes zero', () => {
  const detail = historyDetail();
  detail.exercises[0]!.sets = [];
  assert.match(
    renderToStaticMarkup(<HistoryDetailContent workout={detail} />),
    /No sets recorded/,
  );
  detail.exercises = [];
  assert.match(
    renderToStaticMarkup(<HistoryDetailContent workout={detail} />),
    /No exercises recorded/,
  );
  assert.equal(
    renderToStaticMarkup(<HistoryTime value={null} />),
    '<span>—</span>',
  );
});
void test('History reuses loading, safe failure and Retry patterns without exposing private errors', () => {
  assert.match(
    renderToStaticMarkup(<WorkoutLoading label="Loading workout history..." />),
    /aria-busy="true"/,
  );
  const html = renderToStaticMarkup(
    <WorkoutError title="Workout history unavailable" onRetry={() => undefined}>
      This historical workout is not available to your account.
    </WorkoutError>,
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /Retry/);
  assert.doesNotMatch(html, /SQL|Prisma|stack/);
});
void test('terminal Workout links to History while keeping completed/cancelled mutation controls absent', () => {
  for (const status of ['COMPLETED', 'CANCELLED'] as const) {
    const html = renderToStaticMarkup(
      <WorkoutSessionContent
        session={{ ...historyDetail(), status }}
        busy={null}
        error={null}
        actions={{
          add: async () => true,
          update: async () => true,
          remove: async () => true,
          finish: () => undefined,
        }}
      />,
    );
    assert.match(html, /View in History/);
    assert.ok(html.includes('/history/' + historyDetail().id));
    assert.doesNotMatch(html, /Complete workout|Cancel workout|Add set/);
  }
});
void test('Dashboard recent-workout links use provided session IDs without extra requests', () => {
  const summary = populatedDashboard(),
    html = renderToStaticMarkup(
      <DashboardContent summary={summary} locale="en-GB" />,
    );
  for (const workout of summary.recentWorkouts)
    assert.ok(html.includes('/history/' + workout.id));
});

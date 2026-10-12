import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardContent } from '../src/features/dashboard/dashboard-content';
import {
  DashboardError,
  DashboardSkeleton,
} from '../src/features/dashboard/dashboard.ui';
import {
  emptyDashboard,
  populatedDashboard,
} from './support/dashboard-fixture';

void test('populated UI renders every factual block with canonical numbers, record holders and per-performance values', () => {
  const data = populatedDashboard(),
    before = structuredClone(data);
  const html = renderToStaticMarkup(
    <DashboardContent summary={data} locale="en-US" />,
  );
  for (const label of [
    'Weekly overview',
    'Weekly comparison',
    'Weekly consistency',
    'Muscle groups',
    'Recent workouts',
    'Exercise highlights',
    'Personal records',
    'Body progress',
    'Historical Push Day',
    'Bench snapshot',
    '1,855.75 kg',
    '2h 35m',
    '38m',
    '100 kg',
    '120 kg',
    '101.33 kg',
    '95 kg',
    '80 kg',
    '75 kg',
    '79.25 kg',
    '85 cm',
    'Ending weekly streak',
  ])
    assert.ok(html.includes(label), label);
  assert.match(html, /datetime="2026-09-20T06:00:00Z"/i);
  assert.match(html, /datetime="2026-09-10T06:00:00Z"/i);
  assert.doesNotMatch(
    html,
    /New PR|Recent PRs|current streak|isImproving|recommendations|progressScore|<svg|<canvas/i,
  );
  assert.ok(html.indexOf('>Back<') < html.indexOf('>Chest<'));
  assert.deepEqual(data, before);
});
void test('empty UI keeps all sections visible, nulls neutral and explicit empty messages', () => {
  const html = renderToStaticMarkup(
    <DashboardContent summary={emptyDashboard()} locale="en-US" />,
  );
  for (const message of [
    'No completed workouts yet.',
    'No personal records yet.',
    'No exercise performance yet.',
    'No muscle-group activity this week.',
    'No observations',
    '—',
  ])
    assert.ok(html.includes(message));
  assert.match(html, /Average duration<\/dt><dd[^>]*>—/);
  assert.equal((html.match(/No observations/g) ?? []).length, 5);
});
void test('backend signed differences and percentages are verbatim, including nulls and independent body timelines', () => {
  const data = populatedDashboard();
  data.comparison.completedWorkouts = {
    previous: 3,
    delta: 99,
    percentageChange: 17.89,
  };
  data.comparison.completedSets.percentageChange = null;
  data.bodyProgress.weightKg.change = -7.77;
  data.exerciseHighlights[0]!.previous = null;
  const html = renderToStaticMarkup(
    <DashboardContent summary={data} locale="en-US" />,
  );
  for (const value of [
    '+99',
    '+17.89%',
    '-7.77 kg',
    'No previous performance.',
    '—',
  ])
    assert.ok(html.includes(value));
  assert.match(html, /datetime="2026-09-10T06:00:00Z"/i);
});
void test('loading/error markup is accessible, sanitized and offers retry without fictional metrics', () => {
  const loading = renderToStaticMarkup(<DashboardSkeleton />);
  assert.match(loading, /role="status"/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /Loading dashboard/);
  const error = renderToStaticMarkup(
    <DashboardError onRetry={() => undefined} />,
  );
  assert.match(error, /role="alert"/);
  assert.match(error, /<button[^>]*type="button"[^>]*>Retry/);
  assert.doesNotMatch(error, /SQL|Prisma|stack|0 kg|Weekly overview/);
});

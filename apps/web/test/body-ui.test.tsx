import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MeasurementCards } from '../src/features/body/body-list';
import { MeasurementForm } from '../src/features/body/body-form';
import {
  WorkoutLoading,
  WorkoutError,
} from '../src/features/workout/workout.ui';
import { DashboardContent } from '../src/features/dashboard/dashboard-content';
import { populatedDashboard } from './support/dashboard-fixture';
import { measurementFixture } from './support/body-fixture';

const emptyActions = {
  pendingId: null,
  blocked: false,
  failure: null,
  onDelete: () => undefined,
};
void test('Body empty list offers Add measurement, populated cards preserve backend order/partial values/notes', () => {
  const empty = renderToStaticMarkup(
    <MeasurementCards items={[]} {...emptyActions} />,
  );
  assert.match(empty, /No body measurements yet/);
  assert.match(empty, /href="\/body\/new"/);
  const first = measurementFixture({
      id: 'first',
      weightKg: null,
      waistCm: 84,
      notes: 'First partial',
    }),
    second = measurementFixture({
      id: 'second',
      weightKg: 79.25,
      waistCm: null,
      notes: 'Second partial',
    });
  const html = renderToStaticMarkup(
    <MeasurementCards items={[first, second]} {...emptyActions} />,
  );
  assert.ok(html.indexOf('First partial') < html.indexOf('Second partial'));
  assert.match(html, /84 cm/);
  assert.match(html, /79[.,]25 kg/);
  assert.doesNotMatch(html, /0 kg|0 cm|BMI|latest|previous|change/);
  assert.match(html, /href="\/body\/first\/edit"/);
  assert.match(html, /Delete measurement/);
});
void test('Body create form supports five optional labelled decimal metrics, server Now and notes', () => {
  const html = renderToStaticMarkup(
    <MeasurementForm disabled={false} onSave={async () => true} />,
  );
  for (const key of [
    'weightKg',
    'bodyFatPercent',
    'waistCm',
    'chestCm',
    'hipsCm',
    'notes',
  ])
    assert.ok(html.includes('name="' + key + '"'));
  assert.match(html, /inputMode="decimal"/i);
  assert.match(html, /Now \(server time\)/);
  assert.match(html, /Local date and time/);
  assert.match(html, /Exact timestamp with timezone/);
  assert.doesNotMatch(html, /required|BMI|Profile|targetWeight|height/);
});
void test('Body edit loads existing metrics, offers clearing and preserves recorded timestamp by default', () => {
  const html = renderToStaticMarkup(
    <MeasurementForm
      measurement={measurementFixture()}
      disabled={false}
      onSave={async () => true}
    />,
  );
  assert.match(html, /80\.5/);
  assert.match(html, /Keep recorded time/);
  assert.match(html, /2026-10-01T18:30:00\.123Z/);
  assert.match(html, /Clearing a field removes that metric/);
  assert.match(html, /Save measurement/);
  assert.doesNotMatch(html, /Now \(server time\)/);
});
void test('pending/ambiguous create-edit forms retain values but disable submit, without zero-filling absent metrics', () => {
  const html = renderToStaticMarkup(
    <MeasurementForm
      measurement={measurementFixture({ bodyFatPercent: null })}
      disabled
      onSave={async () => true}
    />,
  );
  assert.match(html, /disabled/);
  assert.match(html, /name="bodyFatPercent"[^>]*value=""/);
  assert.match(html, /Historical morning observation/);
});
void test('pending/ambiguous deletion retains historical cards with sanitized action error and blocks overlapping writes', () => {
  const html = renderToStaticMarkup(
    <MeasurementCards
      items={[measurementFixture()]}
      {...emptyActions}
      pendingId={measurementFixture().id}
      blocked
      failure={{
        id: measurementFixture().id,
        message: 'The result could not be confirmed. Reload.',
      }}
    />,
  );
  assert.match(html, /Deleting/);
  assert.match(html, /disabled/);
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(
    html,
    /href="\/body\/[^\"]+\/edit"|Archive|latest|previous/,
  );
});
void test('Body loading/fetch failures use existing accessible patterns and safe Retry', () => {
  assert.match(
    renderToStaticMarkup(
      <WorkoutLoading label="Loading body measurements..." />,
    ),
    /aria-busy="true"/,
  );
  const html = renderToStaticMarkup(
    <WorkoutError title="Measurement unavailable" onRetry={() => undefined}>
      This measurement is not available to your account.
    </WorkoutError>,
  );
  assert.match(html, /Retry/);
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /SQL|Prisma|stack/);
});
void test('Dashboard links to Body without changing independent per-metric analytics rendering', () => {
  const html = renderToStaticMarkup(
    <DashboardContent summary={populatedDashboard()} locale="en-GB" />,
  );
  assert.match(html, /href="\/body"/);
  assert.match(html, /Manage measurements/);
  assert.match(html, /each metric has its own timeline/);
});

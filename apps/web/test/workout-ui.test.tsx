import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatKg } from '../src/features/dashboard/format';
import { TemplateChoices } from '../src/features/workout/template-picker';
import { WorkoutSessionContent } from '../src/features/workout/workout-session';
import {
  WorkoutError,
  WorkoutLoading,
} from '../src/features/workout/workout.ui';
import {
  sessionFixture,
  templateFixture,
  setFixture,
} from './support/workout-fixture';

const actions = {
  add: async () => true,
  update: async () => true,
  remove: async () => true,
  finish: () => undefined,
};
void test('template picker handles empty, usable/inactive-linked templates and ignores empty planning', () => {
  const empty = renderToStaticMarkup(
    <TemplateChoices
      items={[]}
      pendingId={null}
      error={null}
      onStart={() => undefined}
    />,
  );
  assert.match(empty, /No workout templates yet/);
  const template = templateFixture();
  template.exercises[0]!.exercise.isAvailable = false;
  const html = renderToStaticMarkup(
    <TemplateChoices
      items={[
        template,
        { ...template, id: 'empty', name: 'Not startable', exercises: [] },
      ]}
      pendingId={null}
      error={null}
      onStart={() => undefined}
    />,
  );
  assert.match(html, /Push template/);
  assert.match(html, /Start workout/);
  assert.doesNotMatch(html, /Not startable|Create template/);
});
void test('start pending disables choices, errors preserve picker and no automatic template creation', () => {
  const template = templateFixture();
  const html = renderToStaticMarkup(
    <TemplateChoices
      items={[template]}
      pendingId={template.id}
      error="Unable to start this workout."
      onStart={() => undefined}
    />,
  );
  assert.match(html, /Starting\.\.\./);
  assert.match(html, /disabled/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Push template/);
});
void test('in-progress UI renders only historical snapshots, planning, actual sets and inline actions', () => {
  const session = sessionFixture(),
    before = structuredClone(session);
  const html = renderToStaticMarkup(
    <WorkoutSessionContent
      session={session}
      busy={null}
      error={null}
      actions={actions}
    />,
  );
  for (const label of [
    'Historical Push',
    'Historical Bench',
    'Historical planning only',
    'Set 1',
    formatKg(82.25),
    'Edit',
    'Delete',
    'Add set',
    'Complete workout',
    'Cancel workout',
    '8–10 reps',
  ])
    assert.ok(html.includes(label), label);
  assert.doesNotMatch(
    html,
    /Current catalog Bench|estimated1RM|New PR|volume|timer/i,
  );
  assert.match(html, /inputMode="decimal"/i);
  assert.match(html, /inputMode="numeric"/i);
  assert.match(html, /name="rpe"/);
  assert.match(html, /name="rir"/);
  assert.deepEqual(session, before);
});
void test('empty sets remain a loggable exercise, bodyweight zero and optional null effort remain factual', () => {
  const session = sessionFixture();
  session.exercises[0]!.sets = [];
  assert.match(
    renderToStaticMarkup(
      <WorkoutSessionContent
        session={session}
        busy={null}
        error={null}
        actions={actions}
      />,
    ),
    /No sets recorded/,
  );
  session.exercises[0]!.sets = [
    setFixture({ loadKg: 0, rpe: null, rir: null }),
  ];
  const html = renderToStaticMarkup(
    <WorkoutSessionContent
      session={session}
      busy={null}
      error={null}
      actions={actions}
    />,
  );
  assert.match(html, /0 kg/);
  assert.match(html, /—/);
});
for (const status of ['COMPLETED', 'CANCELLED'] as const)
  void test(
    status + ' is strictly read-only, with distinct factual copy',
    () => {
      const session = {
        ...sessionFixture(),
        status,
        endedAt: '2026-10-12T10:00:00.000Z',
      };
      const html = renderToStaticMarkup(
        <WorkoutSessionContent
          session={session}
          busy={null}
          error={null}
          actions={actions}
        />,
      );
      assert.match(html, /read-only/);
      assert.match(html, /Open Dashboard/);
      assert.doesNotMatch(
        html,
        /Add set|Edit set|Delete set|Complete workout|Cancel workout/,
      );
      assert.ok(
        html.includes(
          status === 'COMPLETED' ? 'Workout completed.' : 'Workout cancelled.',
        ),
      );
    },
  );
void test('pending mutation prevents terminal/set actions without hiding existing session data', () => {
  const html = renderToStaticMarkup(
    <WorkoutSessionContent
      session={sessionFixture()}
      busy="edit:set-id"
      error="Unable to save this change."
      actions={actions}
    />,
  );
  assert.match(html, /Historical Bench/);
  assert.match(html, /82.25 kg/);
  assert.match(html, /disabled/);
  assert.match(html, /role="alert"/);
});
void test('backend delete compaction is rendered exactly from the freshly read response', () => {
  const session = sessionFixture();
  session.exercises[0]!.sets = [
    setFixture({ id: 'surviving-set', position: 1 }),
  ];
  const html = renderToStaticMarkup(
    <WorkoutSessionContent
      session={session}
      busy={null}
      error={null}
      actions={actions}
    />,
  );
  assert.match(html, /surviving-set/);
  assert.match(html, /Set 1/);
  assert.doesNotMatch(html, /Set 2/);
});
void test('ambiguous mutation failure preserves the in-progress form but disables writes until reload', () => {
  const html = renderToStaticMarkup(
    <WorkoutSessionContent
      session={sessionFixture()}
      busy={null}
      blocked
      error="The change could not be confirmed."
      actions={actions}
    />,
  );
  assert.match(html, /Reload the workout before making more changes/);
  assert.match(html, /form/);
  assert.match(html, /<input(?=[^>]*name="loadKg")(?=[^>]*disabled)[^>]*>/);
  assert.match(html, /Complete workout/);
  assert.doesNotMatch(html, /Workout cancelled\./);
});
void test('loading, sanitized global failure and Retry provide accessible non-fictional states', () => {
  assert.match(renderToStaticMarkup(<WorkoutLoading />), /aria-busy="true"/);
  const html = renderToStaticMarkup(
    <WorkoutError title="Workout unavailable" onRetry={() => undefined} />,
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /Retry/);
  assert.doesNotMatch(html, /stack|SQL|Prisma|Historical Bench/);
});

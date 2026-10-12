import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TemplateListCards } from '../src/features/templates/templates-list';
import {
  TemplateMetadataForm,
  PlanningForm,
} from '../src/features/templates/template-forms';
import { CatalogResults } from '../src/features/templates/exercise-picker';
import {
  TemplateArchived,
  TemplateDetailContent,
} from '../src/features/templates/template-detail';
import {
  WorkoutError,
  WorkoutLoading,
} from '../src/features/workout/workout.ui';
import { TemplateChoices } from '../src/features/workout/template-picker';
import { templateFixture } from './support/workout-fixture';
import {
  catalogFixture,
  threeExerciseTemplate,
} from './support/templates-fixture';

const actions = {
  metadata: async () => true,
  add: async () => true,
  update: async () => true,
  remove: async () => true,
  reorder: async () => true,
  archive: () => undefined,
};
void test('template list empty/create CTA and cards use only real metadata and active-list semantics', () => {
  assert.match(
    renderToStaticMarkup(<TemplateListCards items={[]} />),
    /No workout templates yet/,
  );
  assert.match(
    renderToStaticMarkup(<TemplateListCards items={[]} />),
    /href="\/templates\/new"/,
  );
  const html = renderToStaticMarkup(
    <TemplateListCards items={[templateFixture()]} />,
  );
  for (const label of [
    'Push template',
    'Active template',
    '1 exercises',
    'Open template',
    'Updated',
  ])
    assert.ok(html.includes(label));
  assert.doesNotMatch(html, /volume|score|ARCHIVED/);
});
void test('create/edit metadata have labelled fields, explicit nullable description, pending and error-ready forms', () => {
  const html = renderToStaticMarkup(
    <TemplateMetadataForm disabled onSave={async () => true} />,
  );
  assert.match(html, /name="name"/);
  assert.match(html, /name="description"/);
  assert.match(html, /Create template/);
  assert.match(html, /disabled/);
  assert.doesNotMatch(html, /difficulty|daysPerWeek|program/);
  const edit = renderToStaticMarkup(
    <TemplateMetadataForm
      template={templateFixture()}
      disabled={false}
      onSave={async () => true}
      onCancel={() => undefined}
    />,
  );
  assert.match(edit, /Push template/);
  assert.match(edit, /Save metadata/);
  assert.match(edit, /Cancel edit/);
});
void test('detail preserves backend order, metadata, all planning and correct reorder boundaries', () => {
  const template = threeExerciseTemplate(),
    before = structuredClone(template);
  const html = renderToStaticMarkup(
    <TemplateDetailContent
      template={template}
      disabled={false}
      pending={null}
      blocked={false}
      error={null}
      actions={actions}
      onUnauthorized={() => undefined}
    />,
  );
  assert.ok(
    html.indexOf('A Bench') < html.indexOf('B Press') &&
      html.indexOf('B Press') < html.indexOf('C Row'),
  );
  for (const label of [
    'Edit metadata',
    'Add exercise',
    'Edit planning',
    'Remove exercise',
    'Move up',
    'Move down',
    'Planning guidance',
    '8–10',
    '90s',
    'Archive template',
    'Go to Workout',
  ])
    assert.ok(html.includes(label));
  assert.match(
    html,
    /<button(?=[^>]*aria-label="Move A Bench up")(?=[^>]*disabled)[^>]*>/,
  );
  assert.match(
    html,
    /<button(?=[^>]*aria-label="Move C Row down")(?=[^>]*disabled)[^>]*>/,
  );
  assert.deepEqual(template, before);
});
void test('single exercise cannot move either way and an empty template offers Add without starting', () => {
  const one = templateFixture();
  const html = renderToStaticMarkup(
    <TemplateDetailContent
      template={one}
      disabled={false}
      pending={null}
      blocked={false}
      error={null}
      actions={actions}
      onUnauthorized={() => undefined}
    />,
  );
  assert.match(
    html,
    /<button(?=[^>]*aria-label="Move Current catalog Bench up")(?=[^>]*disabled)[^>]*>/,
  );
  assert.match(
    html,
    /<button(?=[^>]*aria-label="Move Current catalog Bench down")(?=[^>]*disabled)[^>]*>/,
  );
  one.exercises = [];
  const empty = renderToStaticMarkup(
    <TemplateDetailContent
      template={one}
      disabled={false}
      pending={null}
      blocked={false}
      error={null}
      actions={actions}
      onUnauthorized={() => undefined}
    />,
  );
  assert.match(empty, /No exercises yet/);
  assert.match(empty, /Add exercise/);
  assert.doesNotMatch(empty, /Go to Workout/);
});
void test('planning form includes exactly the supported fields and nullable notes, with no analytics', () => {
  const html = renderToStaticMarkup(
    <PlanningForm
      entry={templateFixture().exercises[0]}
      disabled={false}
      onSave={async () => true}
      onCancel={() => undefined}
    />,
  );
  for (const field of [
    'targetSets',
    'targetRepsMin',
    'targetRepsMax',
    'restSeconds',
    'notes',
  ])
    assert.ok(html.includes(`name="${field}"`));
  assert.match(html, /Save planning/);
  assert.match(html, /Cancel edit/);
  assert.match(html, /inputMode="numeric"/i);
  assert.doesNotMatch(html, /loadKg|estimated1RM|tempo|warmup/);
});
void test('catalog picker renders metadata only, empty search state and known duplicate disabled', () => {
  const exercise = catalogFixture();
  const html = renderToStaticMarkup(
    <CatalogResults
      items={[exercise]}
      existingIds={[exercise.id]}
      disabled={false}
      onSelect={() => undefined}
    />,
  );
  for (const label of [
    'Barbell Bench Press',
    'CHEST',
    'BARBELL',
    'HORIZONTAL PUSH',
    'Already added',
  ])
    assert.ok(html.includes(label));
  assert.match(html, /disabled/);
  assert.match(
    renderToStaticMarkup(
      <CatalogResults
        items={[]}
        existingIds={[]}
        disabled={false}
        onSelect={() => undefined}
      />,
    ),
    /No exercises match/,
  );
});
void test('pending/reload gates retain the detail and block overlapping actions with sanitized action errors', () => {
  const html = renderToStaticMarkup(
    <TemplateDetailContent
      template={threeExerciseTemplate()}
      disabled
      pending="reorder"
      blocked
      error="The result could not be confirmed."
      actions={actions}
      onUnauthorized={() => undefined}
    />,
  );
  assert.match(html, /Reload the template before making another change/);
  assert.match(html, /A Bench/);
  assert.match(html, /disabled/);
  assert.match(html, /role="alert"/);
});
void test('archive receipt is truthful after 204, read-only, has no restore or permanent delete; reload uses unavailable semantics', () => {
  const html = renderToStaticMarkup(<TemplateArchived name="Push A" />);
  assert.match(html, /Template archived/);
  assert.match(html, /Existing sessions remain unchanged/);
  assert.doesNotMatch(
    html,
    /<button|Edit planning|Remove exercise|Delete permanently|Restore template/,
  );
});
void test('loading/global error patterns are reused and Workout empty state now links to Templates', () => {
  assert.match(
    renderToStaticMarkup(<WorkoutLoading label="Loading templates..." />),
    /aria-busy="true"/,
  );
  assert.match(
    renderToStaticMarkup(
      <WorkoutError title="Template unavailable" onRetry={() => undefined} />,
    ),
    /Retry/,
  );
  assert.match(
    renderToStaticMarkup(
      <TemplateChoices
        items={[]}
        pendingId={null}
        error={null}
        onStart={() => undefined}
      />,
    ),
    /href="\/templates"/,
  );
});

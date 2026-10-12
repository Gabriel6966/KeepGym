import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authReturnPath } from '../src/features/auth/return-path';
import {
  validateMetadata,
  validatePlanning,
  metadataDraft,
  planningDraft,
} from '../src/features/templates/templates.validation';
import {
  ambiguousWrite,
  applyTemplateExercise,
  requestedMove,
  templateMutationMessage,
} from '../src/features/templates/templates.state';
import {
  isWorkoutTemplate,
  isTemplateExercise,
} from '../src/features/workout/workout.contract';
import { createSubmissionLock } from '../src/features/workout/workout-state';
import { ApiError } from '../src/lib/api-client';
import { templateFixture } from './support/workout-fixture';
import { threeExerciseTemplate } from './support/templates-fixture';

void test('metadata uses real name/description fields, Unicode limits and nullable clearing', () => {
  assert.deepEqual(validateMetadata({ name: ' Push A ', description: '' }), {
    input: { name: 'Push A', description: null },
  });
  assert.ok(
    validateMetadata({ name: '😀'.repeat(120), description: 'x'.repeat(1000) })
      .input,
  );
  assert.ok(validateMetadata({ name: ' ', description: '' }).errors?.name);
  assert.ok(
    validateMetadata({ name: 'x'.repeat(121), description: 'x'.repeat(1001) })
      .errors?.description,
  );
  assert.deepEqual(metadataDraft(), { name: '', description: '' });
});
void test('all planning fields accept exact backend limits, zero rest and null notes', () => {
  assert.deepEqual(
    validatePlanning({
      targetSets: '20',
      targetRepsMin: '1',
      targetRepsMax: '100',
      restSeconds: '0',
      notes: '',
    }),
    {
      input: {
        targetSets: 20,
        targetRepsMin: 1,
        targetRepsMax: 100,
        restSeconds: 0,
        notes: null,
      },
    },
  );
  assert.ok(
    validatePlanning({
      targetSets: '1',
      targetRepsMin: '100',
      targetRepsMax: '100',
      restSeconds: '1800',
      notes: 'x'.repeat(500),
    }).input,
  );
  assert.deepEqual(planningDraft(templateFixture().exercises[0]), {
    targetSets: '3',
    targetRepsMin: '8',
    targetRepsMax: '10',
    restSeconds: '90',
    notes: '',
  });
});
void test('blank optional rest is omitted, not converted to zero/null; blank notes are null', () => {
  assert.deepEqual(
    validatePlanning({
      targetSets: '3',
      targetRepsMin: '8',
      targetRepsMax: '10',
      restSeconds: '',
      notes: '',
    }).input,
    {
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 10,
      restSeconds: undefined,
      notes: null,
    },
  );
});
for (const [field, values] of [
  ['targetSets', ['', '0', '21', '3.5', '1e1', '-1']],
  ['targetRepsMin', ['', '0', '101', '8.5']],
  ['targetRepsMax', ['', '0', '101', '10.5']],
  ['restSeconds', ['-1', '1801', '1.5', 'abc']],
  ['notes', ['x'.repeat(501)]],
] as const)
  void test(
    field + ' rejects malformed/out-of-range planning without truncation',
    () => {
      for (const value of values)
        assert.ok(
          validatePlanning({
            targetSets: '3',
            targetRepsMin: '8',
            targetRepsMax: '10',
            restSeconds: '90',
            notes: '',
            [field]: value,
          }).errors?.[field],
        );
    },
  );
void test('reps range obvious validation matches backend; planning never validates actual performance', () => {
  assert.ok(
    validatePlanning({
      targetSets: '3',
      targetRepsMin: '10',
      targetRepsMax: '8',
      restSeconds: '90',
      notes: '',
    }).errors?.targetRepsMax,
  );
});
void test('A B C requests A C B then C A B using entry IDs, not catalog IDs/positions', () => {
  const template = threeExerciseTemplate(),
    before = structuredClone(template);
  assert.deepEqual(requestedMove(template.exercises, 'entry-c', -1), [
    'entry-a',
    'entry-c',
    'entry-b',
  ]);
  const serverEntries = [
    template.exercises[0]!,
    { ...template.exercises[2]!, position: 2 },
    { ...template.exercises[1]!, position: 3 },
  ];
  assert.deepEqual(requestedMove(serverEntries, 'entry-c', -1), [
    'entry-c',
    'entry-a',
    'entry-b',
  ]);
  assert.deepEqual(template, before);
  assert.equal(requestedMove(template.exercises, 'entry-a', -1), null);
  assert.equal(requestedMove(template.exercises, 'entry-c', 1), null);
  assert.equal(requestedMove([template.exercises[0]!], 'entry-a', 1), null);
});
void test('partial add/update accepts server entry positions immutably without client compaction', () => {
  const template = templateFixture(),
    before = structuredClone(template),
    entry = template.exercises[0]!;
  const updated = applyTemplateExercise(template, {
    ...entry,
    position: 7,
    notes: null,
  });
  assert.equal(updated.exercises[0]!.position, 7);
  assert.deepEqual(template, before);
  assert.ok(isWorkoutTemplate(template));
  assert.ok(isTemplateExercise(entry));
  assert.equal(isTemplateExercise({ id: entry.id }), false);
});
void test('pending create/add/reorder share synchronous admission; failure releases lock for an explicit retry', async () => {
  const lock = createSubmissionLock();
  let writes = 0,
    finish: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  async function write() {
    if (!lock.acquire()) return;
    try {
      writes++;
      await pending;
    } finally {
      lock.release();
    }
  }
  const first = write();
  await write();
  assert.equal(writes, 1);
  finish();
  await first;
  await write();
  assert.equal(writes, 2);
});
void test('ambiguous network/invalid-response outcomes require reload, never silent successful/zero data', () => {
  for (const error of [new ApiError('network'), new ApiError('response')]) {
    assert.equal(ambiguousWrite(error), true);
    assert.match(templateMutationMessage(error), /Reload/);
  }
  for (const status of [400, 404, 409]) {
    const error = new ApiError('response', status);
    assert.equal(ambiguousWrite(error), false);
    assert.doesNotMatch(templateMutationMessage(error), /SQL|Prisma|stack/);
  }
});
void test('template login return paths allow only the scoped list/new/detail, with no userId query or external redirect', () => {
  for (const path of ['/templates', '/templates/new', '/templates/opaque-id'])
    assert.equal(authReturnPath(path + '?userId=x'), path);
  for (const path of [
    '//evil.test/templates',
    'https://evil.test/templates',
    '/templates/../../other',
    '/templates-other',
    '/templates/id/other',
  ])
    assert.equal(authReturnPath(path), '/dashboard');
});

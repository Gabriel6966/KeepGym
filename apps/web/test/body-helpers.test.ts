import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { bodyFields } from '../src/features/body/body.types';
import {
  parseBodyDecimal,
  measurementDraft,
  validateMeasurementDraft,
} from '../src/features/body/body.validation';
import {
  ambiguousBodyWrite,
  bodyMutationMessage,
} from '../src/features/body/body-state';
import { ApiError } from '../src/lib/api-client';
import { authReturnPath } from '../src/features/auth/return-path';
import { createSubmissionLock } from '../src/features/workout/workout-state';
import { measurementFixture } from './support/body-fixture';

for (const [raw, expected] of [
  ['79.25', 79.25],
  ['79,25', 79.25],
  [' 80,50 ', 80.5],
  ['', null],
  [' ', null],
  ['0', undefined],
  ['-1', undefined],
  ['79.251', undefined],
  ['1e2', undefined],
  ['1,2.3', undefined],
  ['1000.01', undefined],
] as const)
  void test(
    'Body decimal input ' +
      JSON.stringify(raw) +
      ' distinguishes absence/range/precision without truncation',
    () => assert.equal(parseBodyDecimal(raw, 1000), expected),
  );
void test('metric UX limits mirror actual backend, every field nullable and zero is not absence', () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(bodyFields).map(([key, field]) => [key, field.maximum]),
    ),
    {
      weightKg: 1000,
      bodyFatPercent: 100,
      waistCm: 500,
      chestCm: 500,
      hipsCm: 500,
    },
  );
  assert.equal(parseBodyDecimal('100', 100), 100);
  assert.equal(parseBodyDecimal('100.01', 100), undefined);
  assert.equal(parseBodyDecimal('500', 500), 500);
  assert.equal(parseBodyDecimal('500.01', 500), undefined);
});
void test('weight-only/waist-only/multiple metric creation supports comma input and notes, Now omits measuredAt', () => {
  const draft = measurementDraft();
  assert.deepEqual(
    validateMeasurementDraft({ ...draft, weightKg: '79,25' }).input,
    { weightKg: 79.25 },
  );
  assert.deepEqual(
    validateMeasurementDraft({ ...draft, waistCm: '84' }).input,
    { waistCm: 84 },
  );
  assert.deepEqual(
    validateMeasurementDraft({
      ...draft,
      weightKg: '80.50',
      bodyFatPercent: '20',
      chestCm: '100',
      notes: ' morning ',
    }).input,
    { weightKg: 80.5, bodyFatPercent: 20, chestCm: 100, notes: 'morning' },
  );
});
void test('notes/time do not replace a body metric, all-null and notes-only creation rejected', () => {
  assert.ok(validateMeasurementDraft(measurementDraft()).errors?.form);
  assert.ok(
    validateMeasurementDraft({
      ...measurementDraft(),
      notes: 'morning',
      timeMode: 'exact',
      measuredAt: '2026-10-01T00:00:00Z',
    }).errors?.form,
  );
});
void test('PATCH differentiates omitted/unchanged from explicit null clearing and preserves historical measuredAt', () => {
  const original = measurementFixture(),
    draft = measurementDraft(original);
  assert.deepEqual(
    validateMeasurementDraft({ ...draft, weightKg: '' }, original).input,
    { weightKg: null },
  );
  assert.deepEqual(
    validateMeasurementDraft({ ...draft, notes: '' }, original).input,
    { notes: null },
  );
  assert.deepEqual(
    validateMeasurementDraft({ ...draft, weightKg: '79,00' }, original).input,
    { weightKg: 79 },
  );
  assert.ok(validateMeasurementDraft(draft, original).errors?.form);
  assert.ok(
    validateMeasurementDraft({ ...draft, weightKg: '', waistCm: '' }, original)
      .errors?.form,
  );
});
void test('exact measuredAt changes/unchanged instants serialize explicitly without replacing historical time', () => {
  const original = measurementFixture(),
    draft = measurementDraft(original);
  assert.deepEqual(
    validateMeasurementDraft(
      {
        ...draft,
        timeMode: 'exact',
        measuredAt: '2026-10-01T20:30:00.123+02:00',
        notes: 'edited',
      },
      original,
    ).input,
    { notes: 'edited' },
  );
  assert.deepEqual(
    validateMeasurementDraft(
      { ...draft, timeMode: 'exact', measuredAt: '2026-10-02T08:15:00Z' },
      original,
    ).input,
    { measuredAt: '2026-10-02T08:15:00.000Z' },
  );
  assert.ok(
    validateMeasurementDraft(
      { ...draft, timeMode: 'exact', measuredAt: '2026-10-02T08:15:00' },
      original,
    ).errors?.measuredAt,
  );
});
void test('notes trim/Unicode bound and malformed Decimal values fail before a write', () => {
  assert.ok(
    validateMeasurementDraft({
      ...measurementDraft(),
      weightKg: '80',
      notes: '😀'.repeat(1000),
    }).input,
  );
  assert.ok(
    validateMeasurementDraft({
      ...measurementDraft(),
      weightKg: '80',
      notes: 'x'.repeat(1001),
    }).errors?.notes,
  );
  assert.ok(
    validateMeasurementDraft({ ...measurementDraft(), weightKg: 'NaN' }).errors
      ?.weightKg,
  );
});
function inTimezone(zone: string, expression: string): unknown {
  const time = require.resolve('../src/features/body/body-time'),
    validation = require.resolve('../src/features/body/body.validation');
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      `const t=require(${JSON.stringify(time)}),v=require(${JSON.stringify(validation)}); console.log(JSON.stringify(${expression}));`,
    ],
    { env: { ...process.env, TZ: zone }, encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}
for (const [zone, input, expected] of [
  ['Europe/Madrid', '2026-10-12T20:30', '2026-10-12T20:30:00.000+02:00'],
  ['Europe/Madrid', '2026-01-12T20:30', '2026-01-12T20:30:00.000+01:00'],
  ['Europe/Madrid', '2026-03-29T01:30', '2026-03-29T01:30:00.000+01:00'],
  ['Europe/Madrid', '2026-03-29T02:30', null],
  ['Europe/Madrid', '2026-03-29T03:30', '2026-03-29T03:30:00.000+02:00'],
  ['Europe/Madrid', '2026-10-25T02:30', '2026-10-25T02:30:00.000+02:00'],
  ['Europe/Madrid', '2026-10-25T03:30', '2026-10-25T03:30:00.000+01:00'],
  ['UTC', '2026-10-12T20:30', '2026-10-12T20:30:00.000+00:00'],
  ['America/New_York', '2026-10-12T20:30', '2026-10-12T20:30:00.000-04:00'],
  ['UTC', '2024-02-29T23:59:59.123', '2024-02-29T23:59:59.123+00:00'],
  ['UTC', '2026-02-30T20:30', null],
] as const)
  void test(
    'native browser-style wall clock in isolated ' + zone + ' ' + input,
    () =>
      assert.equal(
        inTimezone(zone, `t.localInputToRFC3339(${JSON.stringify(input)})`),
        expected,
      ),
  );
void test('editing a repeated-hour observation keeps the original later-offset instant, even when displaying local fields', () => {
  const original = measurementFixture({
    measuredAt: '2026-10-25T01:30:00.123Z',
  });
  assert.deepEqual(
    inTimezone(
      'Europe/Madrid',
      `(()=>{const m=${JSON.stringify(original)};return v.validateMeasurementDraft({...v.measurementDraft(m),timeMode:'local',measuredAt:t.instantToLocalInput(m.measuredAt),notes:'edited'},m).input})()`,
    ),
    { notes: 'edited' },
  );
});
void test('ambiguous outcomes gate further writes; errors remain generic and submission admission is synchronous', () => {
  const lock = createSubmissionLock();
  assert.equal(lock.acquire(), true);
  assert.equal(lock.acquire(), false);
  lock.release();
  assert.equal(lock.acquire(), true);
  for (const error of [new ApiError('network'), new ApiError('response')]) {
    assert.equal(ambiguousBodyWrite(error), true);
    assert.match(bodyMutationMessage(error), /Reload/);
  }
  for (const status of [400, 404, 500])
    assert.doesNotMatch(
      bodyMutationMessage(new ApiError('response', status)),
      /SQL|Prisma|stack/,
    );
});
void test('Body auth return routes are closed and never carry ownership selectors', () => {
  for (const path of ['/body', '/body/new', '/body/opaque-id/edit'])
    assert.equal(authReturnPath(path + '?userId=private'), path);
  for (const path of [
    '/body/id',
    '//evil.test/body',
    '/body/id/edit/more',
    '/body/../../other',
  ])
    assert.equal(authReturnPath(path), '/dashboard');
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  exerciseCatalog,
  type ExerciseSeedEntry,
} from '../prisma/exercise-catalog';
import {
  upsertExerciseCatalog,
  validateExerciseCatalog,
  type ExerciseSeedWriter,
} from '../prisma/seed-exercises';
import {
  Equipment,
  MovementPattern,
  MuscleGroup,
} from '../src/generated/prisma/enums';
import type { Exercise, Prisma } from '../src/generated/prisma/client';

void test('seed contains 24 bounded, valid exercises with all required stable slugs and no invalid secondary muscles', () => {
  validateExerciseCatalog(exerciseCatalog);
  assert.equal(exerciseCatalog.length, 24);
  const required = [
    'barbell-bench-press',
    'incline-dumbbell-press',
    'overhead-press',
    'dumbbell-lateral-raise',
    'push-up',
    'pull-up',
    'lat-pulldown',
    'barbell-row',
    'seated-cable-row',
    'back-squat',
    'leg-press',
    'romanian-deadlift',
    'conventional-deadlift',
    'leg-extension',
    'leg-curl',
    'hip-thrust',
    'standing-calf-raise',
    'barbell-biceps-curl',
    'hammer-curl',
    'cable-triceps-pushdown',
    'overhead-triceps-extension',
  ];
  const slugs = new Set(exerciseCatalog.map((entry) => entry.slug));
  assert.equal(slugs.size, 24);
  required.forEach((slug) => assert.ok(slugs.has(slug)));
  for (const entry of exerciseCatalog) {
    assert.equal(entry.isActive, true);
    assert.ok(Object.values(MuscleGroup).includes(entry.primaryMuscle));
    assert.ok(Object.values(Equipment).includes(entry.equipment));
    assert.ok(Object.values(MovementPattern).includes(entry.movementPattern));
    assert.equal(entry.secondaryMuscles.includes(entry.primaryMuscle), false);
    assert.equal(
      new Set(entry.secondaryMuscles).size,
      entry.secondaryMuscles.length,
    );
    assert.ok(entry.instructions.length > 0);
    assert.equal('id' in entry, false);
    assert.equal('userId' in entry, false);
  }
});

void test('seed validation rejects duplicate slugs, invalid metadata and muscle lists before writing', async () => {
  const first = exerciseCatalog[0];
  assert.ok(first);
  assert.throws(() => validateExerciseCatalog([first, first]));
  const patches: Record<string, unknown>[] = [
    { slug: 'UPPERCASE' },
    { slug: 'not_ascii_ñ' },
    { slug: 'a'.repeat(141) },
    { name: ' ' },
    { name: 'x'.repeat(121) },
    { name: ' outer spaces ' },
    { description: '' },
    { description: 'x'.repeat(501) },
    { instructions: [] },
    { instructions: [' '] },
    { secondaryMuscles: [first.primaryMuscle] },
    { secondaryMuscles: ['BICEPS', 'BICEPS'] },
    { primaryMuscle: 'NECK' },
    { secondaryMuscles: ['NECK'] },
    { equipment: 'CHAIR' },
    { movementPattern: 'RUN' },
    { isActive: false },
  ];
  let writes = 0;
  const writer: ExerciseSeedWriter = {
    async upsert(): Promise<Exercise> {
      writes++;
      throw new Error('Invalid catalog must fail before writing.');
    },
  };
  for (const patch of patches) {
    // Runtime corruption despite a statically typed catalog must be rejected too.
    const candidate = { ...first, ...patch } as ExerciseSeedEntry;
    await assert.rejects(
      upsertExerciseCatalog(writer, [
        first,
        {
          ...candidate,
          slug: patch.slug === undefined ? 'other-exercise' : candidate.slug,
        },
      ]),
    );
  }
  assert.equal(writes, 0);
});

void test('seed upserts by slug, updates canonical metadata, preserves IDs and never deletes unrelated exercises', async () => {
  const records = new Map<string, Exercise>();
  const first = exerciseCatalog[0];
  assert.ok(first);
  const preservedId = randomUUID();
  const createdAt = new Date('2026-01-01T00:00:00Z');
  records.set(first.slug, {
    ...first,
    id: preservedId,
    name: 'Old metadata',
    instructions: [...first.instructions],
    secondaryMuscles: [...first.secondaryMuscles],
    createdAt,
    updatedAt: createdAt,
  });
  records.set('unrelated-exercise', {
    ...records.get(first.slug)!,
    id: randomUUID(),
    slug: 'unrelated-exercise',
  });
  const unrelated = records.get('unrelated-exercise');
  const calls: Prisma.ExerciseUpsertArgs[] = [];
  const writer: ExerciseSeedWriter = {
    async upsert(args) {
      calls.push(args);
      const entry = exerciseCatalog.find(
        (item) => item.slug === args.where.slug,
      );
      assert.ok(entry);
      const metadata = {
        ...entry,
        instructions: [...entry.instructions],
        secondaryMuscles: [...entry.secondaryMuscles],
      };
      assert.deepEqual(args.create, metadata);
      assert.deepEqual(args.update, metadata);
      assert.deepEqual(args.where, { slug: entry.slug });
      const existing = records.get(entry.slug);
      const result: Exercise = {
        ...metadata,
        id: existing?.id ?? randomUUID(),
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
      };
      records.set(entry.slug, result);
      return result;
    },
  };
  await upsertExerciseCatalog(writer, exerciseCatalog);
  const originalIds = [...records.values()].map((entry) => entry.id);
  await upsertExerciseCatalog(writer, exerciseCatalog);
  assert.equal(calls.length, 48);
  assert.equal(records.size, 25);
  assert.deepEqual(
    [...records.values()].map((entry) => entry.id),
    originalIds,
  );
  assert.equal(records.get(first.slug)?.id, preservedId);
  assert.equal(records.get(first.slug)?.createdAt, createdAt);
  assert.equal(records.get(first.slug)?.name, first.name);
  assert.equal(records.get('unrelated-exercise'), unrelated);
});

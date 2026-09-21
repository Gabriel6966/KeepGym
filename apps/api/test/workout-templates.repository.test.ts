import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkoutTemplatesRepository } from '../src/workout-templates/workout-templates.repository';
import { ExerciseAlreadyInTemplateError } from '../src/workout-templates/errors/exercise-already-in-template.error';
import { WorkoutTemplatePersistenceError } from '../src/workout-templates/errors/workout-template-persistence.error';
import { WorkoutTemplateBusyError } from '../src/workout-templates/errors/workout-template-busy.error';
import { WorkoutTemplateNotFoundError } from '../src/workout-templates/errors/workout-template-not-found.error';
import { WorkoutTemplatesPrismaFake } from './support/workout-templates-prisma.fake';

function known(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('Private query details', {
    code,
    meta,
    clientVersion: '7.10.0',
  });
}

async function setup(context: TestContext) {
  const db = new WorkoutTemplatesPrismaFake();
  const module = await Test.createTestingModule({
    providers: [
      WorkoutTemplatesRepository,
      { provide: PrismaService, useValue: db },
    ],
  }).compile();
  context.after(() => module.close());
  const repository = module.get(WorkoutTemplatesRepository);
  const user = randomUUID();
  const template = await repository.createTemplate(user, { name: 'Push' });
  const exercise = db.catalog[0];
  assert.ok(exercise);
  const input = {
    exerciseId: exercise.id,
    targetSets: 3,
    targetRepsMin: 6,
    targetRepsMax: 8,
  };
  return { db, repository, user, template, input };
}

void test('repository scopes list/detail/mutations by owner and active status and orders explicitly', async (context) => {
  const { db, repository, user, template } = await setup(context);
  const list = context.mock.method(db.workoutTemplate, 'findMany');
  const count = context.mock.method(db.workoutTemplate, 'count');
  const find = context.mock.method(db.workoutTemplate, 'findFirst');
  const touch = context.mock.method(db.workoutTemplate, 'updateMany');
  await repository.findTemplatesByUser(user, {
    page: 2,
    limit: 10,
    q: '50%_\\',
  });
  const listArgs = list.mock.calls[0]?.arguments[0];
  assert.deepEqual(listArgs?.where, {
    userId: user,
    archivedAt: null,
    name: { contains: '50\\%\\_\\\\', mode: 'insensitive' },
  });
  assert.equal(listArgs?.skip, 10);
  assert.equal(listArgs?.take, 10);
  assert.deepEqual(count.mock.calls[0]?.arguments[0].where, listArgs?.where);
  await repository.findTemplateByIdAndUser(user, template.id);
  assert.deepEqual(find.mock.calls[0]?.arguments[0].where, {
    id: template.id,
    userId: user,
    archivedAt: null,
  });
  await repository.updateTemplate(user, template.id, { name: 'New' });
  assert.deepEqual(touch.mock.calls[0]?.arguments[0].where, {
    id: template.id,
    userId: user,
    archivedAt: null,
  });
  await assert.rejects(
    repository.archiveTemplate(randomUUID(), template.id),
    WorkoutTemplateNotFoundError,
  );
});

for (const meta of [
  {
    modelName: 'WorkoutTemplateExercise',
    target: ['workoutTemplateId', 'exerciseId'],
  },
  {
    modelName: 'WorkoutTemplateExercise',
    target: ['workout_template_id', 'exercise_id'],
  },
  {
    modelName: 'WorkoutTemplateExercise',
    target: 'template_exercises_exercise_key',
  },
  {
    modelName: 'WorkoutTemplateExercise',
    driverAdapterError: {
      cause: {
        kind: 'UniqueConstraintViolation',
        constraint: { index: 'template_exercises_exercise_key' },
      },
    },
  },
]) {
  void test(
    'repository translates only the specific duplicate exercise constraint: ' +
      JSON.stringify(meta),
    async (context) => {
      const { db, repository, user, template, input } = await setup(context);
      context.mock.method(db.workoutTemplateExercise, 'create', async () => {
        throw known('P2002', meta);
      });
      await assert.rejects(
        repository.addExercise(user, template.id, input),
        ExerciseAlreadyInTemplateError,
      );
      assert.equal(db.templates.get(template.id)?.exercises.length, 0);
    },
  );
}

void test('unrelated constraints, unknown Prisma and unexpected failures are sanitized without being mislabeled duplicates', async (context) => {
  const { db, repository, user, template, input } = await setup(context);
  const create = context.mock.method(db.workoutTemplateExercise, 'create');
  for (const error of [
    known('P2002', { target: ['id'] }),
    known('P2002', {
      modelName: 'OtherModel',
      target: 'template_exercises_exercise_key',
    }),
    known('P2002'),
    known('P2003'),
    new Error('SQL and private query values'),
  ]) {
    create.mock.mockImplementation(async () => {
      throw error;
    });
    await assert.rejects(
      repository.addExercise(user, template.id, input),
      (caught: unknown) => {
        assert.ok(caught instanceof WorkoutTemplatePersistenceError);
        assert.equal('cause' in caught, false);
        assert.equal('meta' in caught, false);
        assert.equal(caught.message.includes('SQL'), false);
        return true;
      },
    );
  }
});

void test('serialization and position conflicts are retried at most twice and exhausted conflicts are safe', async (context) => {
  const { db, repository, user, template, input } = await setup(context);
  const original = db.$transaction.bind(db);
  let attempts = 0;
  const transaction = context.mock.method(
    db,
    '$transaction',
    async (...args: Parameters<typeof original>) => {
      attempts++;
      if (attempts === 1) throw known('P2034');
      if (attempts === 2)
        throw known('P2002', {
          modelName: 'WorkoutTemplateExercise',
          target: 'template_exercises_position_key',
        });
      return original(...args);
    },
  );
  assert.equal(
    (await repository.addExercise(user, template.id, input)).position,
    1,
  );
  assert.equal(attempts, 3);
  transaction.mock.mockImplementation(async () => {
    throw known('P2034');
  });
  const before = transaction.mock.calls.length;
  await assert.rejects(
    repository.archiveTemplate(user, template.id),
    WorkoutTemplateBusyError,
  );
  assert.equal(transaction.mock.calls.length - before, 3);
  assert.equal(db.templates.get(template.id)?.archivedAt, null);
});

void test('reorder/delete use temporary unique positions and roll back all writes on mid-operation failure', async (context) => {
  const { db, repository, user, template, input } = await setup(context);
  const ids: string[] = [];
  for (const exercise of db.catalog.slice(0, 3))
    ids.push(
      (
        await repository.addExercise(user, template.id, {
          ...input,
          exerciseId: exercise.id,
        })
      ).id,
    );
  const before = structuredClone(db.templates);
  const original = db.workoutTemplateExercise.update;
  let writes = 0;
  const update = context.mock.method(
    db.workoutTemplateExercise,
    'update',
    async (...args: Parameters<typeof original>) => {
      writes++;
      if (writes === 4)
        throw new Error('Simulated failed final position write');
      return original(...args);
    },
  );
  await assert.rejects(
    repository.reorderTemplateExercises(user, template.id, [...ids].reverse()),
    WorkoutTemplatePersistenceError,
  );
  assert.deepEqual(db.templates, before);
  writes = 0;
  await assert.rejects(
    repository.removeTemplateExercise(user, template.id, ids[1]!),
    WorkoutTemplatePersistenceError,
  );
  assert.deepEqual(db.templates, before);
  update.mock.restore();
  const reordered = await repository.reorderTemplateExercises(
    user,
    template.id,
    [...ids].reverse(),
  );
  assert.deepEqual(
    reordered.exercises.map((entry) => entry.position),
    [1, 2, 3],
  );
  assert.deepEqual(
    reordered.exercises.map((entry) => entry.id),
    [...ids].reverse(),
  );
});

void test('repository count/detail errors stay errors instead of becoming empty pages or missing templates', async (context) => {
  const { db, repository, user, template } = await setup(context);
  context.mock.method(db.workoutTemplate, 'count', async () => {
    throw new Error('private');
  });
  context.mock.method(db.workoutTemplate, 'findFirst', async () => {
    throw new Error('private');
  });
  await assert.rejects(
    repository.findTemplatesByUser(user, { page: 1, limit: 20 }),
    WorkoutTemplatePersistenceError,
  );
  await assert.rejects(
    repository.findTemplateByIdAndUser(user, template.id),
    WorkoutTemplatePersistenceError,
  );
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma, type Exercise } from '../../src/generated/prisma/client';
import type {
  TemplateExerciseRecord,
  TemplateRecord,
} from '../../src/workout-templates/workout-templates.types';
import { catalogRecords } from './in-memory-exercises.repository';

type Scope = {
  id?: string;
  userId?: string;
  archivedAt?: Date | null;
  name?: { contains: string; mode: string };
};
type ChildScope = { id: string; workoutTemplateId: string };

// Small transactional store exercising the real repository/service/controller.
// It enforces the two unique keys and rolls back failed interactive transactions;
// real PostgreSQL isolation is checked separately, not simulated here.
export class WorkoutTemplatesPrismaFake {
  templates = new Map<string, TemplateRecord>();
  catalog: Exercise[] = catalogRecords();
  transactions = 0;

  private matches(template: TemplateRecord, where: Scope): boolean {
    const literal = where.name?.contains
      .replace(/\\([\\%_])/g, '$1')
      .toLowerCase();
    return (
      (where.id === undefined || template.id === where.id) &&
      (where.userId === undefined || template.userId === where.userId) &&
      (where.archivedAt === undefined ||
        template.archivedAt === where.archivedAt) &&
      (literal === undefined || template.name.toLowerCase().includes(literal))
    );
  }

  private hydrate(template: TemplateRecord): TemplateRecord {
    return structuredClone({
      ...template,
      exercises: template.exercises
        .map((entry) => {
          const exercise = this.catalog.find(
            (item) => item.id === entry.exerciseId,
          );
          assert.ok(exercise);
          return { ...entry, exercise };
        })
        .sort((a, b) => a.position - b.position),
    });
  }

  readonly workoutTemplate = {
    create: async ({
      data,
    }: {
      data: { userId: string; name: string; description?: string | null };
    }) => {
      const template: TemplateRecord = {
        id: randomUUID(),
        userId: data.userId,
        name: data.name,
        description: data.description ?? null,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        exercises: [],
      };
      this.templates.set(template.id, template);
      return this.hydrate(template);
    },
    findFirst: async ({ where }: { where: Scope }) => {
      const template = [...this.templates.values()].find((item) =>
        this.matches(item, where),
      );
      return template ? this.hydrate(template) : null;
    },
    findFirstOrThrow: async ({ where }: { where: Scope }) => {
      const template = await this.workoutTemplate.findFirst({ where });
      assert.ok(template);
      return template;
    },
    findMany: async ({
      where,
      skip,
      take,
    }: {
      where: Scope;
      skip: number;
      take: number;
    }) =>
      [...this.templates.values()]
        .filter((item) => this.matches(item, where))
        .sort(
          (a, b) =>
            b.updatedAt.getTime() - a.updatedAt.getTime() ||
            a.id.localeCompare(b.id),
        )
        .slice(skip, skip + take)
        .map((item) => this.hydrate(item)),
    count: async ({ where }: { where: Scope }) =>
      [...this.templates.values()].filter((item) => this.matches(item, where))
        .length,
    updateMany: async ({
      where,
      data,
    }: {
      where: Scope;
      data: { updatedAt: Date };
    }) => {
      const matching = [...this.templates.values()].filter((item) =>
        this.matches(item, where),
      );
      matching.forEach((item) => {
        item.updatedAt = data.updatedAt;
      });
      return { count: matching.length };
    },
    update: async ({
      where,
      data,
    }: {
      where: Scope;
      data: { name?: string; description?: string | null; archivedAt?: Date };
    }) => {
      const template = [...this.templates.values()].find((item) =>
        this.matches(item, where),
      );
      assert.ok(template);
      if (data.name !== undefined) template.name = data.name;
      if (data.description !== undefined)
        template.description = data.description;
      if (data.archivedAt !== undefined) template.archivedAt = data.archivedAt;
      template.updatedAt = new Date();
      return this.hydrate(template);
    },
  };

  private unique(
    template: TemplateRecord,
    entry: TemplateExerciseRecord,
  ): void {
    for (const other of template.exercises) {
      if (other.id === entry.id) continue;
      const field =
        other.exerciseId === entry.exerciseId
          ? 'exerciseId'
          : other.position === entry.position
            ? 'position'
            : undefined;
      if (field)
        throw new Prisma.PrismaClientKnownRequestError('Unique violation', {
          code: 'P2002',
          clientVersion: '7.10.0',
          meta: {
            modelName: 'WorkoutTemplateExercise',
            target: ['workoutTemplateId', field],
          },
        });
    }
  }

  readonly workoutTemplateExercise = {
    create: async ({
      data,
    }: {
      data: Omit<
        TemplateExerciseRecord,
        'id' | 'exercise' | 'createdAt' | 'updatedAt' | 'notes' | 'restSeconds'
      > & { notes?: string | null; restSeconds?: number };
    }) => {
      const template = this.templates.get(data.workoutTemplateId);
      const exercise = this.catalog.find((item) => item.id === data.exerciseId);
      assert.ok(template && exercise);
      const entry: TemplateExerciseRecord = {
        ...data,
        id: randomUUID(),
        restSeconds: data.restSeconds ?? 90,
        notes: data.notes ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        exercise,
      };
      this.unique(template, entry);
      template.exercises.push(entry);
      return structuredClone(entry);
    },
    update: async ({
      where,
      data,
    }: {
      where: ChildScope;
      data: Partial<
        Pick<
          TemplateExerciseRecord,
          | 'position'
          | 'targetSets'
          | 'targetRepsMin'
          | 'targetRepsMax'
          | 'restSeconds'
          | 'notes'
        >
      >;
    }) => {
      const template = this.templates.get(where.workoutTemplateId);
      const entry = template?.exercises.find((item) => item.id === where.id);
      assert.ok(template && entry);
      this.unique(template, { ...entry, ...data });
      Object.assign(entry, data, { updatedAt: new Date() });
      return structuredClone(entry);
    },
    delete: async ({ where }: { where: ChildScope }) => {
      const template = this.templates.get(where.workoutTemplateId);
      const entry = template?.exercises.find((item) => item.id === where.id);
      assert.ok(template && entry);
      template.exercises = template.exercises.filter(
        (item) => item.id !== where.id,
      );
      return structuredClone(entry);
    },
  };

  async $transaction(
    operation:
      | ((tx: WorkoutTemplatesPrismaFake) => Promise<unknown>)
      | Promise<unknown>[],
    options: { isolationLevel: string },
  ): Promise<unknown> {
    this.transactions++;
    if (Array.isArray(operation)) {
      assert.equal(options.isolationLevel, 'RepeatableRead');
      return Promise.all(operation);
    }
    assert.equal(options.isolationLevel, 'Serializable');
    const snapshot = structuredClone(this.templates);
    try {
      return await operation(this);
    } catch (error: unknown) {
      this.templates = snapshot;
      throw error;
    }
  }
}

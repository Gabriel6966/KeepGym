import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type SetEntry,
  type WorkoutSessionExercise,
  type WorkoutSessionStatus,
} from '../../src/generated/prisma/client';
import { snapshotSourceSelect } from '../../src/workout-sessions/workout-sessions.repository';
import type {
  TerminalWorkoutSessionStatus,
  WorkoutSessionRecord,
} from '../../src/workout-sessions/workout-sessions.types';
import { catalogRecords } from './in-memory-exercises.repository';

function cloneSet(entry: SetEntry): SetEntry {
  return {
    ...entry,
    loadKg: new Prisma.Decimal(entry.loadKg),
    rpe: entry.rpe === null ? null : new Prisma.Decimal(entry.rpe),
    completedAt: new Date(entry.completedAt),
    createdAt: new Date(entry.createdAt),
    updatedAt: new Date(entry.updatedAt),
  };
}
function cloneSession(session: WorkoutSessionRecord): WorkoutSessionRecord {
  return {
    ...structuredClone({ ...session, exercises: [] }),
    exercises: session.exercises
      .map(({ sets, ...entry }) => ({
        ...structuredClone(entry),
        sets: [...sets].sort((a, b) => a.position - b.position).map(cloneSet),
      }))
      .sort((a, b) => a.position - b.position),
  };
}

export type SnapshotSource = Prisma.WorkoutTemplateGetPayload<{
  select: typeof snapshotSourceSelect;
}>;
export type SourceRecord = SnapshotSource & {
  userId: string;
  archivedAt: Date | null;
};
export interface SessionScope {
  id?: string;
  userId: string;
  status?: WorkoutSessionStatus;
}
type EntryCreate = Omit<
  WorkoutSessionExercise,
  'id' | 'workoutSessionId' | 'createdAt' | 'updatedAt'
>;
export interface SnapshotCreate {
  userId: string;
  sourceTemplateId: string;
  name: string;
  status: 'IN_PROGRESS';
  notes: null;
  exercises: { create: EntryCreate[] };
}

export function sourceTemplate(userId: string, count = 3): SourceRecord {
  return {
    id: randomUUID(),
    userId,
    archivedAt: null,
    name: 'Push Day',
    exercises: catalogRecords()
      .slice(0, count)
      .map((exercise, index) => ({
        exerciseId: exercise.id,
        position: index + 1,
        targetSets: 4 - index,
        targetRepsMin: 6 + index,
        targetRepsMax: 8 + index,
        restSeconds: index === 0 ? 0 : 120,
        notes: index === 0 ? 'Controlled movement' : null,
        exercise: {
          name: exercise.name,
          slug: exercise.slug,
          primaryMuscle: exercise.primaryMuscle,
          secondaryMuscles: [...exercise.secondaryMuscles],
          equipment: exercise.equipment,
          movementPattern: exercise.movementPattern,
        },
      })),
  };
}

// This double exercises the real repository with snapshots/rollback. It is not
// a SQL isolation emulator: PostgreSQL concurrency and FKs are verified separately.
export class WorkoutSessionsPrismaFake {
  // Deterministic write serialization for unit tests, not a SQL lock emulator.
  private pendingWrite: Promise<void> = Promise.resolve();
  templates = new Map<string, SourceRecord>();
  sessions = new Map<string, WorkoutSessionRecord>();
  sourceReads: {
    where: { id: string; userId: string; archivedAt: null };
    select: typeof snapshotSourceSelect;
  }[] = [];

  private matches(session: WorkoutSessionRecord, where: SessionScope): boolean {
    return (
      session.userId === where.userId &&
      (where.id === undefined || where.id === session.id) &&
      (where.status === undefined || where.status === session.status)
    );
  }

  readonly workoutSession = {
    create: async ({ data }: { data: SnapshotCreate }) => {
      const id = randomUUID();
      const now = new Date();
      const session: WorkoutSessionRecord = {
        id,
        userId: data.userId,
        sourceTemplateId: data.sourceTemplateId,
        name: data.name,
        status: data.status,
        notes: data.notes,
        startedAt: now,
        endedAt: null,
        createdAt: now,
        updatedAt: now,
        exercises: data.exercises.create.map((entry) => ({
          ...structuredClone(entry),
          id: randomUUID(),
          workoutSessionId: id,
          createdAt: now,
          updatedAt: now,
          sets: [],
        })),
      };
      this.sessions.set(id, session);
      return cloneSession(session);
    },
    findFirst: async ({ where }: { where: SessionScope }) => {
      const session = [...this.sessions.values()].find((item) =>
        this.matches(item, where),
      );
      return session
        ? cloneSession({
            ...session,
            exercises: [...session.exercises].sort(
              (a, b) => a.position - b.position,
            ),
          })
        : null;
    },
    findMany: async ({
      where,
      skip,
      take,
    }: {
      where: SessionScope;
      skip: number;
      take: number;
      orderBy: unknown;
    }) =>
      [...this.sessions.values()]
        .filter((item) => this.matches(item, where))
        .sort(
          (a, b) =>
            b.startedAt.getTime() - a.startedAt.getTime() ||
            b.id.localeCompare(a.id),
        )
        .slice(skip, skip + take)
        .map(cloneSession),
    count: async ({ where }: { where: SessionScope }) =>
      [...this.sessions.values()].filter((item) => this.matches(item, where))
        .length,
    updateMany: async ({
      where,
      data,
    }: {
      where: SessionScope;
      data:
        | { status: TerminalWorkoutSessionStatus; endedAt: Date }
        | { updatedAt: Date };
    }) => {
      const matching = [...this.sessions.values()].filter((item) =>
        this.matches(item, where),
      );
      for (const session of matching)
        Object.assign(session, data, { updatedAt: new Date() });
      return { count: matching.length };
    },
  };

  readonly workoutSessionExercise = {
    findFirst: async ({
      where,
    }: {
      where: { id: string; workoutSessionId: string };
    }) => {
      const exercise = this.sessions
        .get(where.workoutSessionId)
        ?.exercises.find((entry) => entry.id === where.id);
      return exercise
        ? {
            id: exercise.id,
            sets: [...exercise.sets]
              .sort((a, b) => a.position - b.position)
              .map(cloneSet),
          }
        : null;
    },
  };

  private exercise(id: string) {
    const exercise = [...this.sessions.values()]
      .flatMap((session) => session.exercises)
      .find((entry) => entry.id === id);
    assert.ok(exercise);
    return exercise;
  }

  private ensurePosition(
    exerciseId: string,
    position: number,
    excludedId?: string,
  ): void {
    assert.ok(position >= 1);
    if (
      this.exercise(exerciseId).sets.some(
        (entry) => entry.id !== excludedId && entry.position === position,
      )
    )
      throw new Prisma.PrismaClientKnownRequestError('Unique position', {
        code: 'P2002',
        clientVersion: '7.10.0',
        meta: {
          modelName: 'SetEntry',
          target: ['workoutSessionExerciseId', 'position'],
        },
      });
  }

  readonly setEntry = {
    create: async ({
      data,
    }: {
      data: Pick<
        SetEntry,
        'workoutSessionExerciseId' | 'position' | 'loadKg' | 'reps'
      > &
        Partial<Pick<SetEntry, 'rpe' | 'rir'>>;
    }) => {
      this.ensurePosition(data.workoutSessionExerciseId, data.position);
      const entry: SetEntry = {
        ...data,
        id: randomUUID(),
        rpe: data.rpe ?? null,
        rir: data.rir ?? null,
        completedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.exercise(data.workoutSessionExerciseId).sets.push(cloneSet(entry));
      return cloneSet(entry);
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string; workoutSessionExerciseId: string };
      data: Partial<
        Pick<SetEntry, 'position' | 'loadKg' | 'reps' | 'rpe' | 'rir'>
      >;
    }) => {
      const entry = this.exercise(where.workoutSessionExerciseId).sets.find(
        (set) => set.id === where.id,
      );
      assert.ok(entry);
      this.ensurePosition(
        where.workoutSessionExerciseId,
        data.position ?? entry.position,
        entry.id,
      );
      if (data.position !== undefined) entry.position = data.position;
      if (data.loadKg !== undefined)
        entry.loadKg = new Prisma.Decimal(data.loadKg);
      if (data.reps !== undefined) entry.reps = data.reps;
      if (data.rpe !== undefined)
        entry.rpe = data.rpe === null ? null : new Prisma.Decimal(data.rpe);
      if (data.rir !== undefined) entry.rir = data.rir;
      entry.updatedAt = new Date();
      return cloneSet(entry);
    },
    delete: async ({
      where,
    }: {
      where: { id: string; workoutSessionExerciseId: string };
    }) => {
      const exercise = this.exercise(where.workoutSessionExerciseId);
      const entry = exercise.sets.find((set) => set.id === where.id);
      assert.ok(entry);
      exercise.sets = exercise.sets.filter((set) => set.id !== where.id);
      return cloneSet(entry);
    },
  };

  async $transaction(
    operation:
      | ((tx: {
          workoutSession: WorkoutSessionsPrismaFake['workoutSession'];
          workoutSessionExercise: WorkoutSessionsPrismaFake['workoutSessionExercise'];
          setEntry: WorkoutSessionsPrismaFake['setEntry'];
          workoutTemplate: {
            findFirst: (
              args: WorkoutSessionsPrismaFake['sourceReads'][number],
            ) => Promise<SnapshotSource | null>;
          };
        }) => Promise<unknown>)
      | Promise<unknown>[],
    options: { isolationLevel: string },
  ): Promise<unknown> {
    if (Array.isArray(operation)) {
      assert.equal(options.isolationLevel, 'RepeatableRead');
      return Promise.all(operation);
    }
    assert.ok(
      ['RepeatableRead', 'ReadCommitted'].includes(options.isolationLevel),
    );
    let release: (() => void) | undefined;
    if (options.isolationLevel === 'ReadCommitted') {
      const previous = this.pendingWrite;
      this.pendingWrite = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
    }
    const sources = structuredClone(this.templates);
    const before = new Map(
      [...this.sessions].map(([id, session]) => [id, cloneSession(session)]),
    );
    try {
      return await operation({
        workoutSession: this.workoutSession,
        workoutSessionExercise: this.workoutSessionExercise,
        setEntry: this.setEntry,
        workoutTemplate: {
          findFirst: async (args) => {
            assert.equal(options.isolationLevel, 'RepeatableRead');
            this.sourceReads.push(args);
            const source = sources.get(args.where.id);
            return source &&
              source.userId === args.where.userId &&
              source.archivedAt === null
              ? structuredClone(source)
              : null;
          },
        },
      });
    } catch (error: unknown) {
      this.sessions = before;
      throw error;
    } finally {
      release?.();
    }
  }
}

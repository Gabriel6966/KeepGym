import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type {
  Prisma,
  WorkoutSessionExercise,
  WorkoutSessionStatus,
} from '../../src/generated/prisma/client';
import { snapshotSourceSelect } from '../../src/workout-sessions/workout-sessions.repository';
import type {
  TerminalWorkoutSessionStatus,
  WorkoutSessionRecord,
} from '../../src/workout-sessions/workout-sessions.types';
import { catalogRecords } from './in-memory-exercises.repository';

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
        })),
      };
      this.sessions.set(id, session);
      return structuredClone(session);
    },
    findFirst: async ({ where }: { where: SessionScope }) => {
      const session = [...this.sessions.values()].find((item) =>
        this.matches(item, where),
      );
      return session
        ? structuredClone({
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
        .map((item) => structuredClone(item)),
    count: async ({ where }: { where: SessionScope }) =>
      [...this.sessions.values()].filter((item) => this.matches(item, where))
        .length,
    updateMany: async ({
      where,
      data,
    }: {
      where: SessionScope;
      data: { status: TerminalWorkoutSessionStatus; endedAt: Date };
    }) => {
      const matching = [...this.sessions.values()].filter((item) =>
        this.matches(item, where),
      );
      for (const session of matching)
        Object.assign(session, data, { updatedAt: new Date() });
      return { count: matching.length };
    },
  };

  async $transaction(
    operation:
      | ((tx: {
          workoutSession: WorkoutSessionsPrismaFake['workoutSession'];
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
    const sources = structuredClone(this.templates);
    const before = structuredClone(this.sessions);
    try {
      return await operation({
        workoutSession: this.workoutSession,
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
    }
  }
}

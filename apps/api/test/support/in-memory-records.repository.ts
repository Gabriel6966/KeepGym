import { randomUUID } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client';
import type { WorkoutSessionStatus } from '../../src/generated/prisma/enums';
import type { RecordsRepository } from '../../src/records/records.repository';
import type {
  RecordCandidate,
  RecordExerciseSnapshot,
  ExerciseRecordData,
} from '../../src/records/records.types';

export interface OwnedRecordOccurrence {
  userId: string;
  status: WorkoutSessionStatus;
  sessionId: string;
  startedAt: Date;
  snapshot: RecordExerciseSnapshot;
  sets: RecordCandidate[];
}
export function recordsFixture() {
  const owner = randomUUID();
  const other = randomUUID();
  const exerciseId = randomUUID();
  function occurrence(
    userId: string,
    status: WorkoutSessionStatus,
    day: number,
    pairs: [number, number][],
  ): OwnedRecordOccurrence {
    const sessionId = randomUUID();
    const startedAt = new Date(Date.UTC(2026, 8, day, 10));
    return {
      userId,
      status,
      sessionId,
      startedAt,
      snapshot: {
        sourceExerciseId: exerciseId,
        exerciseName: 'Snapshot Bench ' + day,
        exerciseSlug: 'snapshot-bench',
        primaryMuscle: 'CHEST',
        secondaryMuscles: ['TRICEPS'],
        equipment: 'BARBELL',
        movementPattern: 'HORIZONTAL_PUSH',
      },
      sets: pairs.map(([load, reps], index) => ({
        sessionId,
        sessionName: 'Snapshot workout ' + day,
        sessionStartedAt: startedAt,
        setId: randomUUID(),
        position: index + 1,
        loadKg: String(load),
        reps,
        rpe: '8.5',
        rir: 2,
        completedAt: new Date(startedAt.getTime() + 60000 * (index + 1)),
      })),
    };
  }
  const first = occurrence(owner, 'COMPLETED', 1, [
    [80, 8],
    [100, 3],
  ]);
  const second = occurrence(owner, 'COMPLETED', 2, [[95, 6]]);
  const later = occurrence(owner, 'COMPLETED', 3, [[100, 5]]);
  const cancelled = occurrence(owner, 'CANCELLED', 4, [[150, 3]]);
  const active = occurrence(owner, 'IN_PROGRESS', 5, [[160, 1]]);
  const foreign = occurrence(other, 'COMPLETED', 6, [[200, 1]]);
  const occurrences = [later, active, foreign, second, cancelled, first];
  return {
    owner,
    other,
    exerciseId,
    first,
    second,
    later,
    cancelled,
    active,
    foreign,
    occurrences,
  };
}

function firstMax(a: RecordCandidate, b: RecordCandidate): number {
  return (
    new Prisma.Decimal(b.loadKg).comparedTo(a.loadKg) ||
    a.completedAt.getTime() - b.completedAt.getTime() ||
    a.setId.localeCompare(b.setId)
  );
}
export class InMemoryRecordsRepository implements Pick<
  RecordsRepository,
  'findExerciseRecordData'
> {
  constructor(readonly occurrences: OwnedRecordOccurrence[]) {}
  findExerciseRecordData(
    userId: string,
    exerciseId: string,
  ): Promise<ExerciseRecordData> {
    const matched = this.occurrences
      .filter(
        (entry) =>
          entry.userId === userId &&
          entry.status === 'COMPLETED' &&
          entry.snapshot.sourceExerciseId === exerciseId,
      )
      .sort(
        (a, b) =>
          b.startedAt.getTime() - a.startedAt.getTime() ||
          b.sessionId.localeCompare(a.sessionId),
      );
    const sets = matched
      .flatMap((entry) => entry.sets)
      .filter((set) => new Prisma.Decimal(set.loadKg).gt(0))
      .sort(firstMax);
    const candidates = new Map<number, RecordCandidate>();
    for (const set of sets)
      if (set.reps >= 1 && set.reps <= 20 && !candidates.has(set.reps))
        candidates.set(set.reps, set);
    return Promise.resolve({
      exercise: matched[0]?.snapshot ?? null,
      maxLoad: sets[0] ?? null,
      estimatedCandidates: [...candidates.values()],
    });
  }
}

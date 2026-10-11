import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import {
  calculateEstimated1RM,
  estimated1RMScore,
  roundMetric,
} from '../analytics/analytics.math';
import { RecordsRepository } from './records.repository';
import { InvalidRecordsQueryError } from './errors/invalid-records-query.error';
import { RecordsPersistenceError } from './errors/records-persistence.error';
import { personalRecordTypes } from './records.types';
import type {
  CurrentRecordCandidate,
  PublicCurrentRecord,
  PublicCurrentRecords,
  ExerciseRecords,
  PersonalRecordType,
  PublicPersonalRecord,
  RecordCandidate,
} from './records.types';

function selectEstimatedRecord<T extends RecordCandidate>(
  candidates: readonly T[],
): T | undefined {
  return candidates
    .flatMap((candidate) => {
      const score = estimated1RMScore(candidate.loadKg, candidate.reps);
      return score === null ? [] : [{ candidate, score }];
    })
    .sort(
      (a, b) =>
        b.score.comparedTo(a.score) ||
        a.candidate.completedAt.getTime() - b.candidate.completedAt.getTime() ||
        a.candidate.setId.localeCompare(b.candidate.setId),
    )[0]?.candidate;
}

function publicCurrentRecord(
  candidate: CurrentRecordCandidate,
  type: PersonalRecordType,
  valueKg: number,
): PublicCurrentRecord {
  return {
    type,
    exercise: {
      sourceExerciseId: candidate.sourceExerciseId,
      name: candidate.exerciseName,
      slug: candidate.exerciseSlug,
    },
    valueKg,
    achievedAt: candidate.completedAt,
    workoutSessionId: candidate.sessionId,
    setEntryId: candidate.setId,
    loadKg: roundMetric(candidate.loadKg),
    reps: candidate.reps,
  };
}

function publicRecord<T extends PersonalRecordType>(
  candidate: RecordCandidate,
  type: T,
  valueKg: number,
): PublicPersonalRecord<T> {
  return {
    type,
    valueKg,
    achievedAt: candidate.completedAt,
    session: {
      id: candidate.sessionId,
      name: candidate.sessionName,
      startedAt: candidate.sessionStartedAt,
    },
    set: {
      id: candidate.setId,
      position: candidate.position,
      loadKg: roundMetric(candidate.loadKg),
      reps: candidate.reps,
      rpe: candidate.rpe === null ? null : roundMetric(candidate.rpe),
      rir: candidate.rir,
      completedAt: candidate.completedAt,
    },
  };
}

@Injectable()
export class RecordsService {
  constructor(private readonly repository: RecordsRepository) {}

  async getCurrentRecords(
    userId: string,
    limit = 5,
  ): Promise<PublicCurrentRecords> {
    if (typeof userId !== 'string' || !isUUID(userId))
      throw new InvalidRecordsQueryError();
    if (!Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new InvalidRecordsQueryError(
        'Limit must be an integer between 1 and 20.',
      );
    try {
      const data = await this.repository.findCurrentRecordCandidates(userId);
      const items = data.maxLoadCandidates
        .filter((candidate) => roundMetric(candidate.loadKg) > 0)
        .map((candidate) =>
          publicCurrentRecord(
            candidate,
            'MAX_LOAD',
            roundMetric(candidate.loadKg),
          ),
        );
      const byExercise = new Map<string, CurrentRecordCandidate[]>();
      for (const candidate of data.estimatedCandidates) {
        const group = byExercise.get(candidate.sourceExerciseId) ?? [];
        group.push(candidate);
        byExercise.set(candidate.sourceExerciseId, group);
      }
      for (const candidates of byExercise.values()) {
        const best = selectEstimatedRecord(candidates);
        const value = best
          ? calculateEstimated1RM(best.loadKg, best.reps)
          : null;
        if (best && value !== null)
          items.push(publicCurrentRecord(best, 'ESTIMATED_1RM', value));
      }
      items.sort(
        (a, b) =>
          b.achievedAt.getTime() - a.achievedAt.getTime() ||
          personalRecordTypes.indexOf(a.type) -
            personalRecordTypes.indexOf(b.type) ||
          a.exercise.sourceExerciseId.localeCompare(
            b.exercise.sourceExerciseId,
          ) ||
          a.setEntryId.localeCompare(b.setEntryId),
      );
      return { items: items.slice(0, limit) };
    } catch {
      throw new RecordsPersistenceError();
    }
  }

  async getExerciseRecords(
    userId: string,
    exerciseId: string,
  ): Promise<ExerciseRecords> {
    if (
      [userId, exerciseId].some((id) => typeof id !== 'string' || !isUUID(id))
    )
      throw new InvalidRecordsQueryError();
    const data = await this.repository.findExerciseRecordData(
      userId,
      exerciseId,
    );
    const best = selectEstimatedRecord(data.estimatedCandidates);
    const estimatedValue = best
      ? calculateEstimated1RM(best.loadKg, best.reps)
      : null;
    const snapshot = data.exercise;
    return {
      exercise:
        snapshot === null
          ? null
          : {
              sourceExerciseId: snapshot.sourceExerciseId,
              name: snapshot.exerciseName,
              slug: snapshot.exerciseSlug,
              primaryMuscle: snapshot.primaryMuscle,
              secondaryMuscles: [...snapshot.secondaryMuscles],
              equipment: snapshot.equipment,
              movementPattern: snapshot.movementPattern,
            },
      maxLoadRecord:
        data.maxLoad && roundMetric(data.maxLoad.loadKg) > 0
          ? publicRecord(
              data.maxLoad,
              'MAX_LOAD',
              roundMetric(data.maxLoad.loadKg),
            )
          : null,
      estimated1RMRecord:
        best && estimatedValue !== null
          ? publicRecord(best, 'ESTIMATED_1RM', estimatedValue)
          : null,
    };
  }
}

import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import {
  calculateEstimated1RM,
  estimated1RMScore,
  roundMetric,
} from '../analytics/analytics.math';
import { RecordsRepository } from './records.repository';
import { InvalidRecordsQueryError } from './errors/invalid-records-query.error';
import type {
  ExerciseRecords,
  PersonalRecordType,
  PublicPersonalRecord,
  RecordCandidate,
} from './records.types';

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
    const best = data.estimatedCandidates
      .flatMap((candidate) => {
        const score = estimated1RMScore(candidate.loadKg, candidate.reps);
        return score === null ? [] : [{ candidate, score }];
      })
      .sort(
        (a, b) =>
          b.score.comparedTo(a.score) ||
          a.candidate.completedAt.getTime() -
            b.candidate.completedAt.getTime() ||
          a.candidate.setId.localeCompare(b.candidate.setId),
      )[0]?.candidate;
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

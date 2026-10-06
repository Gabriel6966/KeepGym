import { normalizeWeeklyTrainingTrends } from '../training-trends/training-trends.validation';
import { InvalidTrainingTrendsQueryError } from '../training-trends/errors/invalid-training-trends-query.error';
import { InvalidTrainingDurationQueryError } from './errors/invalid-training-duration-query.error';
import type {
  WeeklyTrainingDurationInput,
  WeeklyTrainingDurationQuery,
} from './training-duration.types';

export function normalizeWeeklyTrainingDuration(
  userId: string,
  input: WeeklyTrainingDurationInput,
): WeeklyTrainingDurationQuery {
  try {
    // The same timestamp, 730-day range and IANA contract as global trends.
    return normalizeWeeklyTrainingTrends(userId, input);
  } catch (error: unknown) {
    if (error instanceof InvalidTrainingTrendsQueryError)
      throw new InvalidTrainingDurationQueryError(error.message);
    throw error;
  }
}

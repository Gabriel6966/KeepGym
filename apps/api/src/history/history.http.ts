import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvalidHistoryQueryError } from './errors/invalid-history-query.error';
import { WorkoutHistoryNotFoundError } from './errors/workout-history-not-found.error';

export async function historyHttp<T>(result: Promise<T>): Promise<T> {
  try {
    return await result;
  } catch (error: unknown) {
    if (error instanceof InvalidHistoryQueryError)
      throw new BadRequestException(error.message);
    if (error instanceof WorkoutHistoryNotFoundError)
      throw new NotFoundException(error.message);
    throw error;
  }
}

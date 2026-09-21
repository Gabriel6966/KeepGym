export class ExerciseNotFoundError extends Error {
  constructor() {
    super('Exercise not found.');
    this.name = 'ExerciseNotFoundError';
  }
}

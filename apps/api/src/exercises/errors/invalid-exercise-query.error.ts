export class InvalidExerciseQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidExerciseQueryError';
  }
}

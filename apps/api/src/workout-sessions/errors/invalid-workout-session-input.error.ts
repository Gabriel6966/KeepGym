export class InvalidWorkoutSessionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWorkoutSessionInputError';
  }
}

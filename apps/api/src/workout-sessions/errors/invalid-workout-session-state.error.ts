export class InvalidWorkoutSessionStateError extends Error {
  constructor() {
    super('Workout session has already ended.');
    this.name = 'InvalidWorkoutSessionStateError';
  }
}

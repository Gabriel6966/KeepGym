export class WorkoutSessionNotFoundError extends Error {
  constructor() {
    super('Workout session not found.');
    this.name = 'WorkoutSessionNotFoundError';
  }
}

export class WorkoutSessionPersistenceError extends Error {
  constructor() {
    super('Unable to persist workout session data.');
    this.name = 'WorkoutSessionPersistenceError';
  }
}

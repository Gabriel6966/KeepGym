export class WorkoutSessionNotEditableError extends Error {
  constructor() {
    super('Workout session is no longer editable.');
    this.name = 'WorkoutSessionNotEditableError';
  }
}

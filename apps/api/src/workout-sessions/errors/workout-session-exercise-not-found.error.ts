export class WorkoutSessionExerciseNotFoundError extends Error {
  constructor() {
    super('Workout session exercise not found.');
    this.name = 'WorkoutSessionExerciseNotFoundError';
  }
}

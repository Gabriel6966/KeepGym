export class WorkoutSessionBusyError extends Error {
  constructor() {
    super('Workout data changed concurrently. Please retry.');
    this.name = 'WorkoutSessionBusyError';
  }
}

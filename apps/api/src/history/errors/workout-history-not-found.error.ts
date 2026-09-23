export class WorkoutHistoryNotFoundError extends Error {
  constructor() {
    super('Workout history not found.');
  }
}

export class WorkoutTemplateNotFoundError extends Error {
  constructor() {
    super('Workout template not found.');
    this.name = 'WorkoutTemplateNotFoundError';
  }
}

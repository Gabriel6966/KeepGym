export class WorkoutTemplatePersistenceError extends Error {
  constructor() {
    super('Unable to persist workout template data.');
    this.name = 'WorkoutTemplatePersistenceError';
  }
}

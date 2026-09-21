export class ExercisePersistenceError extends Error {
  constructor() {
    super('The exercise persistence operation could not be completed.');
    this.name = 'ExercisePersistenceError';
  }
}

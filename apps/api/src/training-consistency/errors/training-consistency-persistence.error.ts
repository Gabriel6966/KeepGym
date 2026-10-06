export class TrainingConsistencyPersistenceError extends Error {
  constructor() {
    super('Unable to read weekly training consistency.');
  }
}

export class TrainingTrendsPersistenceError extends Error {
  constructor() {
    super('Unable to read weekly training trends.');
  }
}

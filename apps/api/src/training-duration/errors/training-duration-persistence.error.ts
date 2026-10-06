export class TrainingDurationPersistenceError extends Error {
  constructor() {
    super('Unable to read weekly training duration.');
  }
}

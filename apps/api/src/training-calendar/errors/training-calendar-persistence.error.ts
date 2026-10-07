export class TrainingCalendarPersistenceError extends Error {
  constructor() {
    super('Unable to read training calendar.');
  }
}

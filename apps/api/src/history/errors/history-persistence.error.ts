export class HistoryPersistenceError extends Error {
  constructor() {
    super('Unable to read workout history.');
  }
}

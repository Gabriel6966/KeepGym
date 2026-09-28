export class RecordsPersistenceError extends Error {
  constructor() {
    super('Unable to read exercise records.');
  }
}

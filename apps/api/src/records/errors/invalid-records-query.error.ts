export class InvalidRecordsQueryError extends Error {
  constructor() {
    super('Identifiers must be UUIDs.');
  }
}

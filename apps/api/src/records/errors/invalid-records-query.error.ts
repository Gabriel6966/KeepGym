export class InvalidRecordsQueryError extends Error {
  constructor(message = 'Identifiers must be UUIDs.') {
    super(message);
  }
}

export class SessionPersistenceError extends Error {
  constructor() {
    super('The session persistence operation could not be completed.');
    this.name = 'SessionPersistenceError';
  }
}

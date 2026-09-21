export class ProfilePersistenceError extends Error {
  constructor() {
    super('The profile persistence operation could not be completed.');
    this.name = 'ProfilePersistenceError';
  }
}

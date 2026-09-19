export class UserPersistenceError extends Error {
  constructor() {
    super('The user persistence operation could not be completed.');
    this.name = 'UserPersistenceError';
  }
}

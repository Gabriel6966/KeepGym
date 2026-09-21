export class ProfileAlreadyExistsError extends Error {
  constructor() {
    super('A profile already exists for this user.');
    this.name = 'ProfileAlreadyExistsError';
  }
}

export class InvalidUserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidUserInputError';
  }
}

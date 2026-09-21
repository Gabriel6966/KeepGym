export class InvalidProfileInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidProfileInputError';
  }
}

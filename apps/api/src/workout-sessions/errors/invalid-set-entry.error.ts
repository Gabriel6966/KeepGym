export class InvalidSetEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSetEntryError';
  }
}

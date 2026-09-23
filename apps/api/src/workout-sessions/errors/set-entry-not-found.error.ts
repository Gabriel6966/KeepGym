export class SetEntryNotFoundError extends Error {
  constructor() {
    super('Set entry not found.');
    this.name = 'SetEntryNotFoundError';
  }
}

export class BodyAnalyticsPersistenceError extends Error {
  constructor() {
    super('The body analytics query could not be completed.');
    this.name = 'BodyAnalyticsPersistenceError';
  }
}

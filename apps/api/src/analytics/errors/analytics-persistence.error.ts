export class AnalyticsPersistenceError extends Error {
  constructor() {
    super('Unable to read workout analytics.');
  }
}

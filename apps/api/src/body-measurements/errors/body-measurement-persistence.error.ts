export class BodyMeasurementPersistenceError extends Error {
  constructor() {
    super('The body measurement persistence operation could not be completed.');
    this.name = 'BodyMeasurementPersistenceError';
  }
}

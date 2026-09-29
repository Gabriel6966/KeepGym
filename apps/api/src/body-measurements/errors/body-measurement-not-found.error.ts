export class BodyMeasurementNotFoundError extends Error {
  constructor() {
    super('Body measurement not found.');
    this.name = 'BodyMeasurementNotFoundError';
  }
}

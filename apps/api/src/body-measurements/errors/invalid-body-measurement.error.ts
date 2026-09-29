export class InvalidBodyMeasurementError extends Error {
  constructor(message = 'Invalid body measurement.') {
    super(message);
    this.name = 'InvalidBodyMeasurementError';
  }
}

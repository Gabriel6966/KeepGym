export class InvalidBodyAnalyticsQueryError extends Error {
  constructor(message = 'Invalid body analytics query.') {
    super(message);
    this.name = 'InvalidBodyAnalyticsQueryError';
  }
}

export class InvalidDashboardQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDashboardQueryError';
  }
}

export class DashboardReadError extends Error {
  constructor() {
    super('Unable to read dashboard summary.');
    this.name = 'DashboardReadError';
  }
}

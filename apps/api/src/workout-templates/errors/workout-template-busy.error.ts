export class WorkoutTemplateBusyError extends Error {
  constructor() {
    super('The workout template changed concurrently. Please retry.');
    this.name = 'WorkoutTemplateBusyError';
  }
}

export class EmptyWorkoutTemplateError extends Error {
  constructor() {
    super('Cannot start a workout session from an empty template.');
    this.name = 'EmptyWorkoutTemplateError';
  }
}

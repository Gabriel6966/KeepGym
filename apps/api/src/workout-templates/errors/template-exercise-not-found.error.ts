export class TemplateExerciseNotFoundError extends Error {
  constructor() {
    super('Template exercise not found.');
    this.name = 'TemplateExerciseNotFoundError';
  }
}

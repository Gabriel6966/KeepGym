export class ExerciseAlreadyInTemplateError extends Error {
  constructor() {
    super('Exercise is already in this template.');
    this.name = 'ExerciseAlreadyInTemplateError';
  }
}

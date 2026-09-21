export class InvalidWorkoutTemplateInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWorkoutTemplateInputError';
  }
}

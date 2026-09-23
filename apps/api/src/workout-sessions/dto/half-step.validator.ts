import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'halfStep', async: false })
export class HalfStepValidator implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      Number.isInteger(value * 2)
    );
  }

  defaultMessage(): string {
    return 'rpe must use increments of 0.5';
  }
}

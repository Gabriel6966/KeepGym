import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { isValidBirthDate } from '../birth-date';

@ValidatorConstraint({ name: 'isBirthDate', async: false })
export class IsBirthDate implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isValidBirthDate(value);
  }

  defaultMessage(): string {
    return 'birthDate must be a real, non-future calendar date in YYYY-MM-DD format';
  }
}

import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { historyTimestamp } from '../history.validation';

@ValidatorConstraint({ name: 'historyTimestamp', async: false })
export class HistoryTimestampValidator implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return historyTimestamp(value) !== null;
  }
  defaultMessage(): string {
    return 'Date must be a real RFC3339 timestamp with timezone and at most millisecond precision';
  }
}

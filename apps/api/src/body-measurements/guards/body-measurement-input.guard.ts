import {
  BadRequestException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class BodyMeasurementInputGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const handler = context.getHandler().name;
    if (handler !== 'list' && Object.keys(request.query).length > 0)
      throw new BadRequestException(
        'Only the measurement list accepts query parameters.',
      );
    const body: unknown = request.body;
    if (['create', 'update'].includes(handler)) {
      if (typeof body !== 'object' || body === null || Array.isArray(body))
        throw new BadRequestException('Body must be an object.');
    } else if (
      body !== undefined &&
      (typeof body !== 'object' ||
        body === null ||
        Array.isArray(body) ||
        Object.keys(body).length > 0)
    )
      throw new BadRequestException(
        'This operation does not accept body fields.',
      );
    return true;
  }
}

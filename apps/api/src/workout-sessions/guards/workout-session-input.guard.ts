import {
  BadRequestException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class WorkoutSessionInputGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const handler = context.getHandler().name;
    if (handler !== 'list' && Object.keys(request.query).length > 0)
      throw new BadRequestException(
        'Only the workout session list accepts query parameters.',
      );
    const body: unknown = request.body;
    // These mutations use DTOs; other routes accept no payload (or {}).
    if (
      !['start', 'addSet', 'updateSet'].includes(handler) &&
      body !== undefined &&
      (typeof body !== 'object' ||
        body === null ||
        Array.isArray(body) ||
        Object.keys(body).length > 0)
    )
      throw new BadRequestException(
        'This workout session operation does not accept body fields.',
      );
    return true;
  }
}

import {
  BadRequestException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class HistoryInputGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      context.getHandler().name === 'getWorkout' &&
      Object.keys(request.query).length > 0
    )
      throw new BadRequestException(
        'Workout history detail does not accept query parameters.',
      );
    const body: unknown = request.body;
    if (
      body !== undefined &&
      (typeof body !== 'object' ||
        body === null ||
        Array.isArray(body) ||
        Object.keys(body).length > 0)
    )
      throw new BadRequestException('History does not accept body fields.');
    return true;
  }
}

import {
  BadRequestException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class BodyAnalyticsInputGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const body: unknown = context.switchToHttp().getRequest<Request>().body;
    if (
      body !== undefined &&
      (typeof body !== 'object' ||
        body === null ||
        Array.isArray(body) ||
        Object.keys(body).length > 0)
    )
      throw new BadRequestException(
        'Body analytics does not accept body fields.',
      );
    return true;
  }
}

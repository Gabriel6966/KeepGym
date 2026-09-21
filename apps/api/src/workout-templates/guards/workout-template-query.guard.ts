import {
  BadRequestException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class WorkoutTemplateQueryGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      context.getHandler().name !== 'list' &&
      Object.keys(request.query).length > 0
    )
      throw new BadRequestException(
        'Only the template list accepts query parameters.',
      );
    return true;
  }
}

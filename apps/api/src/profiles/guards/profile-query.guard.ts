import {
  BadRequestException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class ProfileQueryGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    // Self-service routes have no selectors; reject userId and all other queries.
    if (Object.keys(request.query).length > 0) {
      throw new BadRequestException(
        'Profile routes do not accept query parameters.',
      );
    }
    return true;
  }
}

import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  environmentConfig,
  type EnvironmentConfig,
} from '../../config/environment.config';

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(
    @Inject(environmentConfig.KEY) private readonly config: EnvironmentConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.headers.origin !== this.config.frontendOrigin) {
      throw new ForbiddenException('Invalid request origin');
    }
    return true;
  }
}

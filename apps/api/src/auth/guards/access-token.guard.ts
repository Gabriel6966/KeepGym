import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import type { AuthenticatedRequest } from '../types/auth.types';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const token =
      typeof authorization === 'string'
        ? /^Bearer (\S+)$/i.exec(authorization)?.[1]
        : undefined;

    try {
      if (!token) {
        throw new Error('Missing bearer token.');
      }

      const payload: unknown = await this.jwtService.verifyAsync(token, {
        algorithms: ['HS256'],
      });

      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('sub' in payload) ||
        typeof payload.sub !== 'string' ||
        !isUUID(payload.sub) ||
        !('exp' in payload) ||
        typeof payload.exp !== 'number' ||
        !Number.isFinite(payload.exp)
      ) {
        throw new Error('Invalid access claims.');
      }

      request.principal = { userId: payload.sub };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }
}

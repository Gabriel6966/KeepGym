import { Inject, Injectable } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import {
  environmentConfig,
  type EnvironmentConfig,
} from '../config/environment.config';
import type { SessionGrant } from '../sessions/sessions.types';

@Injectable()
export class RefreshCookieService {
  constructor(
    @Inject(environmentConfig.KEY) private readonly config: EnvironmentConfig,
  ) {}

  read(request: { cookies?: unknown }): string | undefined {
    const cookies = request.cookies;
    if (
      typeof cookies !== 'object' ||
      cookies === null ||
      Array.isArray(cookies)
    )
      return undefined;
    const value: unknown = Object.getOwnPropertyDescriptor(
      cookies,
      this.config.authRefreshCookieName,
    )?.value;
    return typeof value === 'string' ? value : undefined;
  }

  set(response: Pick<Response, 'cookie'>, session: SessionGrant): void {
    response.cookie(this.config.authRefreshCookieName, session.refreshToken, {
      ...this.options(),
      expires: session.expiresAt,
      maxAge: Math.max(0, session.expiresAt.getTime() - Date.now()),
    });
  }

  clear(response: Pick<Response, 'clearCookie'>): void {
    // The same scope must be used to remove the cookie; no stale Max-Age/Expires.
    response.clearCookie(this.config.authRefreshCookieName, this.options());
  }

  private options(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.authRefreshCookieSecure,
      path: '/auth',
    };
  }
}

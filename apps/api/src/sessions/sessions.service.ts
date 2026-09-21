import { Inject, Injectable } from '@nestjs/common';
import {
  environmentConfig,
  type EnvironmentConfig,
} from '../config/environment.config';
import { InvalidRefreshTokenError } from './errors/invalid-refresh-token.error';
import { RefreshTokenService } from './refresh-token.service';
import { SessionsRepository } from './sessions.repository';
import type { SessionGrant } from './sessions.types';

@Injectable()
export class SessionsService {
  constructor(
    private readonly repository: SessionsRepository,
    private readonly tokens: RefreshTokenService,
    @Inject(environmentConfig.KEY) private readonly config: EnvironmentConfig,
  ) {}

  async create(userId: string): Promise<SessionGrant> {
    const now = new Date();
    const secret = this.tokens.generateSecret();
    const session = await this.repository.create({
      userId,
      refreshTokenHash: this.tokens.hash(secret),
      expiresAt: new Date(
        now.getTime() + this.config.authRefreshTtlDays * 86400000,
      ),
      lastUsedAt: now,
    });
    return {
      sessionId: session.id,
      userId: session.userId,
      refreshToken: this.tokens.build(session.id, secret),
      expiresAt: session.expiresAt,
    };
  }

  async rotate(token: string | undefined): Promise<SessionGrant> {
    const parsed = this.tokens.parse(token);
    if (!parsed) throw new InvalidRefreshTokenError();
    const session = await this.repository.findById(parsed.sessionId);
    const now = new Date();
    if (!session || session.revokedAt || session.expiresAt <= now) {
      throw new InvalidRefreshTokenError();
    }
    if (!this.tokens.matches(parsed.secret, session.refreshTokenHash)) {
      await this.repository.revoke(session.id, now);
      throw new InvalidRefreshTokenError();
    }

    const secret = this.tokens.generateSecret();
    const rotated = await this.repository.rotate(
      session.id,
      session.refreshTokenHash,
      this.tokens.hash(secret),
      new Date(),
    );
    if (!rotated) {
      // A losing concurrent refresh is also a reuse attempt: invalidate its winner.
      await this.repository.revoke(session.id, new Date());
      throw new InvalidRefreshTokenError();
    }
    return {
      sessionId: session.id,
      userId: session.userId,
      refreshToken: this.tokens.build(session.id, secret),
      expiresAt: session.expiresAt,
    };
  }

  async revoke(token: string | undefined): Promise<void> {
    const parsed = this.tokens.parse(token);
    if (!parsed) return;
    const session = await this.repository.findById(parsed.sessionId);
    const now = new Date();
    if (!session || session.revokedAt || session.expiresAt <= now) return;
    // Logout never revokes an arbitrary session using only a guessed/public UUID.
    if (!this.tokens.matches(parsed.secret, session.refreshTokenHash)) return;
    await this.repository.revoke(session.id, now);
  }

  revokeAll(userId: string): Promise<void> {
    return this.repository.revokeAll(userId, new Date());
  }
}

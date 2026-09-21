import { Injectable } from '@nestjs/common';
import type { Session } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SessionPersistenceError } from './errors/session-persistence.error';
import type { CreateSessionInput } from './sessions.types';

@Injectable()
export class SessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateSessionInput): Promise<Session> {
    try {
      return await this.prisma.session.create({
        data: {
          userId: input.userId,
          refreshTokenHash: input.refreshTokenHash,
          expiresAt: input.expiresAt,
          lastUsedAt: input.lastUsedAt,
        },
      });
    } catch {
      throw new SessionPersistenceError();
    }
  }

  async findById(id: string): Promise<Session | null> {
    try {
      return await this.prisma.session.findUnique({ where: { id } });
    } catch {
      throw new SessionPersistenceError();
    }
  }

  async rotate(
    id: string,
    expectedHash: string,
    nextHash: string,
    now: Date,
  ): Promise<boolean> {
    try {
      // Compare-and-swap: concurrent refreshes cannot both consume the same hash.
      const result = await this.prisma.session.updateMany({
        where: {
          id,
          refreshTokenHash: expectedHash,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { refreshTokenHash: nextHash, lastUsedAt: now },
      });
      return result.count === 1;
    } catch {
      throw new SessionPersistenceError();
    }
  }

  async revoke(id: string, now: Date): Promise<void> {
    try {
      await this.prisma.session.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: now },
      });
    } catch {
      throw new SessionPersistenceError();
    }
  }

  async revokeAll(userId: string, now: Date): Promise<void> {
    try {
      await this.prisma.session.updateMany({
        where: { userId, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
    } catch {
      throw new SessionPersistenceError();
    }
  }
}

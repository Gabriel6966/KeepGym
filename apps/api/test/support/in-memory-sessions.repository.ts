import { randomUUID } from 'node:crypto';
import type { Session } from '../../src/generated/prisma/client';
import type { SessionsRepository } from '../../src/sessions/sessions.repository';
import type { CreateSessionInput } from '../../src/sessions/sessions.types';

export class InMemorySessionsRepository implements Pick<
  SessionsRepository,
  'create' | 'findById' | 'rotate' | 'revoke' | 'revokeAll'
> {
  readonly sessions = new Map<string, Session>();

  async create(input: CreateSessionInput): Promise<Session> {
    const session: Session = {
      ...input,
      id: randomUUID(),
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return { ...session };
  }

  async findById(id: string): Promise<Session | null> {
    const session = this.sessions.get(id);
    // Return snapshots, as a database does: concurrent readers do not share mutable rows.
    return session ? { ...session } : null;
  }

  async rotate(
    id: string,
    expectedHash: string,
    nextHash: string,
    now: Date,
  ): Promise<boolean> {
    const session = this.sessions.get(id);
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.refreshTokenHash !== expectedHash
    )
      return false;
    session.refreshTokenHash = nextHash;
    session.lastUsedAt = now;
    session.updatedAt = now;
    return true;
  }

  async revoke(id: string, now: Date): Promise<void> {
    const session = this.sessions.get(id);
    if (session && !session.revokedAt) {
      session.revokedAt = now;
      session.updatedAt = now;
    }
  }

  async revokeAll(userId: string, now: Date): Promise<void> {
    for (const session of this.sessions.values()) {
      if (
        session.userId === userId &&
        !session.revokedAt &&
        session.expiresAt > now
      ) {
        session.revokedAt = now;
        session.updatedAt = now;
      }
    }
  }
}

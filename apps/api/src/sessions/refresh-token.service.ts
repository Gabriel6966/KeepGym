import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { ParsedRefreshToken } from './sessions.types';

@Injectable()
export class RefreshTokenService {
  generateSecret(): string {
    return randomBytes(32).toString('base64url');
  }

  build(sessionId: string, secret: string): string {
    return `${sessionId}.${secret}`;
  }

  parse(token: unknown): ParsedRefreshToken | null {
    if (typeof token !== 'string' || token.length !== 80) return null;
    const [sessionId, secret] = token.split('.');
    if (
      !sessionId ||
      !isUUID(sessionId) ||
      !secret ||
      !/^[A-Za-z0-9_-]{43}$/.test(secret)
    ) {
      return null;
    }
    // Require a canonical encoding, not multiple textual aliases for the same secret.
    const bytes = Buffer.from(secret, 'base64url');
    if (bytes.length !== 32 || bytes.toString('base64url') !== secret)
      return null;
    return { sessionId: sessionId.toLowerCase(), secret };
  }

  hash(secret: string): string {
    return createHash('sha256').update(secret, 'utf8').digest('hex');
  }

  matches(secret: string, expectedHash: string): boolean {
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) return false;
    return timingSafeEqual(
      Buffer.from(this.hash(secret), 'hex'),
      Buffer.from(expectedHash, 'hex'),
    );
  }
}

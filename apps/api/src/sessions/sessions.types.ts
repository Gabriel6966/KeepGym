export interface CreateSessionInput {
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  lastUsedAt: Date;
}

export interface ParsedRefreshToken {
  sessionId: string;
  secret: string;
}

// Internal handoff to Auth/HTTP cookie handling, never an HTTP JSON response.
export interface SessionGrant {
  sessionId: string;
  userId: string;
  refreshToken: string;
  expiresAt: Date;
}

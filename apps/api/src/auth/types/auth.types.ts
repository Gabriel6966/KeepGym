import type { IncomingHttpHeaders } from 'node:http';
import type { PublicUser } from '../../users/users.types';
import type { SessionGrant } from '../../sessions/sessions.types';

export interface AuthInput {
  email: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: PublicUser;
}

// Internal result. Controllers return only response and send session via HttpOnly cookie.
export interface AuthResult {
  response: AuthResponse;
  session: SessionGrant;
}

export interface AccessPrincipal {
  userId: string;
}

export interface AuthenticatedRequest {
  headers: IncomingHttpHeaders;
  principal?: AccessPrincipal;
}

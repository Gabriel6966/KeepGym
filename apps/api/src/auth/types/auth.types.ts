import type { IncomingHttpHeaders } from 'node:http';
import type { PublicUser } from '../../users/users.types';

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

export interface AccessPrincipal {
  userId: string;
}

export interface AuthenticatedRequest {
  headers: IncomingHttpHeaders;
  principal?: AccessPrincipal;
}

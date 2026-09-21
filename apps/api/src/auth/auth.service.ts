import { randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  environmentConfig,
  type EnvironmentConfig,
} from '../config/environment.config';
import { UsersService } from '../users/users.service';
import { SessionsService } from '../sessions/sessions.service';
import { InvalidRefreshTokenError } from '../sessions/errors/invalid-refresh-token.error';
import type { PublicUser } from '../users/users.types';
import { InvalidCredentialsError } from './errors/invalid-credentials.error';
import { PasswordHasher } from './password-hasher.service';
import type { AuthInput, AuthResponse, AuthResult } from './types/auth.types';

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyPasswordHash!: string;

  constructor(
    private readonly usersService: UsersService,
    private readonly passwordHasher: PasswordHasher,
    private readonly jwtService: JwtService,
    private readonly sessionsService: SessionsService,
    @Inject(environmentConfig.KEY)
    private readonly config: EnvironmentConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    // A missing user still incurs one Argon2 verification, without a fixed secret.
    this.dummyPasswordHash = await this.passwordHasher.hash(
      randomBytes(32).toString('hex'),
    );
  }

  async register(input: AuthInput): Promise<AuthResult> {
    const passwordHash = await this.passwordHasher.hash(input.password);
    const user = await this.usersService.create({
      email: input.email,
      passwordHash,
    });
    return this.createSessionResult(user);
  }

  async login(input: AuthInput): Promise<AuthResult> {
    const credentials = await this.usersService.findCredentialsByEmail(
      input.email,
    );
    const valid = await this.passwordHasher.verify(
      credentials?.passwordHash ?? this.dummyPasswordHash,
      input.password,
    );

    if (!credentials || !valid) {
      throw new InvalidCredentialsError();
    }

    return this.createSessionResult(credentials);
  }

  async refresh(token: string | undefined): Promise<AuthResult> {
    const session = await this.sessionsService.rotate(token);
    const user = await this.usersService.findById(session.userId);
    if (!user) {
      await this.sessionsService.revoke(session.refreshToken);
      throw new InvalidRefreshTokenError();
    }
    return { response: await this.createAuthResponse(user), session };
  }

  logout(token: string | undefined): Promise<void> {
    return this.sessionsService.revoke(token);
  }

  logoutAll(userId: string): Promise<void> {
    return this.sessionsService.revokeAll(userId);
  }

  findCurrentUser(userId: string): Promise<PublicUser | null> {
    return this.usersService.findById(userId);
  }

  private async createAuthResponse(user: PublicUser): Promise<AuthResponse> {
    // A fresh standard jti distinguishes tokens issued within the same second.
    const accessToken = await this.jwtService.signAsync(
      { sub: user.id },
      { jwtid: randomUUID() },
    );

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.jwtAccessTtlSeconds,
      // Explicit allowlist: structural typing alone does not remove private fields.
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  }

  private async createSessionResult(user: PublicUser): Promise<AuthResult> {
    const response = await this.createAuthResponse(user);
    const session = await this.sessionsService.create(user.id);
    return { response, session };
  }
}

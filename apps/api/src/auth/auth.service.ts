import { randomBytes } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  environmentConfig,
  type EnvironmentConfig,
} from '../config/environment.config';
import { UsersService } from '../users/users.service';
import type { PublicUser } from '../users/users.types';
import { InvalidCredentialsError } from './errors/invalid-credentials.error';
import { PasswordHasher } from './password-hasher.service';
import type { AuthInput, AuthResponse } from './types/auth.types';

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyPasswordHash!: string;

  constructor(
    private readonly usersService: UsersService,
    private readonly passwordHasher: PasswordHasher,
    private readonly jwtService: JwtService,
    @Inject(environmentConfig.KEY)
    private readonly config: EnvironmentConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    // A missing user still incurs one Argon2 verification, without a fixed secret.
    this.dummyPasswordHash = await this.passwordHasher.hash(
      randomBytes(32).toString('hex'),
    );
  }

  async register(input: AuthInput): Promise<AuthResponse> {
    const passwordHash = await this.passwordHasher.hash(input.password);
    const user = await this.usersService.create({
      email: input.email,
      passwordHash,
    });
    return this.createAuthResponse(user);
  }

  async login(input: AuthInput): Promise<AuthResponse> {
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

    return this.createAuthResponse(credentials);
  }

  findCurrentUser(userId: string): Promise<PublicUser | null> {
    return this.usersService.findById(userId);
  }

  private async createAuthResponse(user: PublicUser): Promise<AuthResponse> {
    const accessToken = await this.jwtService.signAsync({ sub: user.id });

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
}

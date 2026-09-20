import { Injectable } from '@nestjs/common';
import type { User } from '../generated/prisma/client';
import { InvalidUserInputError } from './errors/invalid-user-input.error';
import { UsersRepository } from './users.repository';
import type {
  CreateUserInput,
  PublicUser,
  UserCredentials,
} from './users.types';

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();

  if (!normalized || normalized.length > 320) {
    throw new InvalidUserInputError(
      'Email must contain between 1 and 320 characters.',
    );
  }

  return normalized;
}

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async create(input: CreateUserInput): Promise<PublicUser> {
    const email = normalizeEmail(input.email);

    if (!input.passwordHash.trim()) {
      throw new InvalidUserInputError('A password hash is required.');
    }

    const user = await this.usersRepository.create({
      email,
      passwordHash: input.passwordHash,
    });

    return toPublicUser(user);
  }

  async findById(id: string): Promise<PublicUser | null> {
    const user = await this.usersRepository.findById(id);
    return user ? toPublicUser(user) : null;
  }

  async findByEmail(email: string): Promise<PublicUser | null> {
    const user = await this.usersRepository.findByEmail(normalizeEmail(email));
    return user ? toPublicUser(user) : null;
  }

  async findCredentialsByEmail(email: string): Promise<UserCredentials | null> {
    const user = await this.usersRepository.findByEmail(normalizeEmail(email));
    return user
      ? { ...toPublicUser(user), passwordHash: user.passwordHash }
      : null;
  }
}

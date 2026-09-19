import { Injectable } from '@nestjs/common';
import { Prisma, type User } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UserEmailAlreadyExistsError } from './errors/user-email-already-exists.error';
import { UserPersistenceError } from './errors/user-persistence.error';
import type { CreateUserInput } from './users.types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEmailUniqueViolation(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002' ||
    (error.meta?.modelName !== undefined && error.meta.modelName !== 'User')
  ) {
    return false;
  }

  const target = error.meta?.target;

  if (
    target === 'users_email_key' ||
    (Array.isArray(target) && target.length === 1 && target[0] === 'email')
  ) {
    return true;
  }

  // Prisma 7 with adapter-pg supplies the PostgreSQL constraint in the cause.
  const adapterError = error.meta?.driverAdapterError;

  if (!isRecord(adapterError) || !isRecord(adapterError.cause)) {
    return false;
  }

  const { kind, constraint } = adapterError.cause;

  return (
    kind === 'UniqueConstraintViolation' &&
    isRecord(constraint) &&
    constraint.index === 'users_email_key'
  );
}

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateUserInput): Promise<User> {
    try {
      return await this.prisma.user.create({
        data: { email: input.email, passwordHash: input.passwordHash },
      });
    } catch (error: unknown) {
      if (isEmailUniqueViolation(error)) {
        throw new UserEmailAlreadyExistsError();
      }

      // Prisma errors may contain query arguments. Do not attach the raw cause.
      throw new UserPersistenceError();
    }
  }

  async findById(id: string): Promise<User | null> {
    try {
      return await this.prisma.user.findUnique({ where: { id } });
    } catch {
      throw new UserPersistenceError();
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    try {
      return await this.prisma.user.findUnique({ where: { email } });
    } catch {
      throw new UserPersistenceError();
    }
  }
}

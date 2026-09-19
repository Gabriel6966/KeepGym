import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrismaService } from '../src/prisma/prisma.service';

void test('Prisma rejects missing or invalid database URLs without exposing their contents', () => {
  const previousUrl = process.env.DATABASE_URL;
  const invalidConfigurations = [
    {
      value: undefined,
      message: 'DATABASE_URL is required. Configure apps/api/.env.',
    },
    {
      value: 'not-a-database-url',
      message: 'DATABASE_URL must be a valid PostgreSQL URL.',
    },
    {
      value: 'https://localhost/gym_app',
      message: 'DATABASE_URL must specify a PostgreSQL host and database.',
    },
    {
      value: 'postgresql://localhost/',
      message: 'DATABASE_URL must specify a PostgreSQL host and database.',
    },
  ];

  try {
    for (const { value, message } of invalidConfigurations) {
      if (value === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = value;
      }

      assert.throws(() => new PrismaService(), { message });
    }
  } finally {
    if (previousUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousUrl;
    }
  }
});

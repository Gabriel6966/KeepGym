import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL is required. Configure apps/api/.env.');
    }

    let databaseUrl: URL;

    try {
      databaseUrl = new URL(connectionString);
    } catch {
      throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
    }

    if (
      !['postgresql:', 'postgres:'].includes(databaseUrl.protocol) ||
      !databaseUrl.hostname ||
      databaseUrl.pathname.length <= 1
    ) {
      throw new Error(
        'DATABASE_URL must specify a PostgreSQL host and database.',
      );
    }

    super({
      adapter: new PrismaPg(
        { connectionString },
        { schema: databaseUrl.searchParams.get('schema') ?? 'public' },
      ),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

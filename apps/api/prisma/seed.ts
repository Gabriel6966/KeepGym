import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { seedExercises } from './seed-exercises';
import { exerciseCatalog } from './exercise-catalog';

async function main(): Promise<void> {
  // The Prisma CLI loads .env through prisma.config.ts before invoking this seed.
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error('DATABASE_URL is required for seeding.');
  const url = new URL(connectionString);
  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length <= 1
  )
    throw new Error('Invalid database configuration.');
  const prisma = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString },
      { schema: url.searchParams.get('schema') ?? 'public' },
    ),
  });
  try {
    await seedExercises(prisma);
    console.log(
      `Exercise catalog seeded successfully (${exerciseCatalog.length} canonical exercises).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  // Connection/query errors may contain credentials; do not print their cause.
  console.error(
    'Exercise seed failed. Check database connectivity, migrations and catalog validation.',
  );
  process.exitCode = 1;
});

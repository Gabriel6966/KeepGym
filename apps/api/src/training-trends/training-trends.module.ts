import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TrainingTrendsController } from './training-trends.controller';
import { TrainingTrendsService } from './training-trends.service';
import { TrainingTrendsRepository } from './training-trends.repository';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [TrainingTrendsController],
  providers: [TrainingTrendsService, TrainingTrendsRepository],
})
export class TrainingTrendsModule {}

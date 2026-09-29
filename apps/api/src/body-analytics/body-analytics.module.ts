import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BodyAnalyticsController } from './body-analytics.controller';
import { BodyAnalyticsRepository } from './body-analytics.repository';
import { BodyAnalyticsService } from './body-analytics.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [BodyAnalyticsController],
  providers: [BodyAnalyticsRepository, BodyAnalyticsService],
})
export class BodyAnalyticsModule {}

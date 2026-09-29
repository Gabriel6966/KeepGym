import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BodyMeasurementsController } from './body-measurements.controller';
import { BodyMeasurementsRepository } from './body-measurements.repository';
import { BodyMeasurementsService } from './body-measurements.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [BodyMeasurementsController],
  providers: [BodyMeasurementsRepository, BodyMeasurementsService],
})
export class BodyMeasurementsModule {}

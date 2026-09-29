import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_PIPE } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { environmentConfig } from './config/environment.config';
import { ExercisesModule } from './exercises/exercises.module';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { ProfilesModule } from './profiles/profiles.module';
import { UsersModule } from './users/users.module';
import { WorkoutTemplatesModule } from './workout-templates/workout-templates.module';
import { WorkoutSessionsModule } from './workout-sessions/workout-sessions.module';
import { HistoryModule } from './history/history.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { RecordsModule } from './records/records.module';
import { BodyMeasurementsModule } from './body-measurements/body-measurements.module';
import { BodyAnalyticsModule } from './body-analytics/body-analytics.module';
import { TrainingTrendsModule } from './training-trends/training-trends.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [environmentConfig],
    }),
    PrismaModule,
    UsersModule,
    AuthModule,
    ProfilesModule,
    ExercisesModule,
    WorkoutTemplatesModule,
    WorkoutSessionsModule,
    HistoryModule,
    AnalyticsModule,
    RecordsModule,
    BodyMeasurementsModule,
    BodyAnalyticsModule,
    TrainingTrendsModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          validationError: { target: false, value: false },
        }),
    },
  ],
})
export class AppModule {}

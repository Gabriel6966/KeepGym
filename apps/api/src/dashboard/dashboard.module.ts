import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { BodyAnalyticsModule } from '../body-analytics/body-analytics.module';
import { HistoryModule } from '../history/history.module';
import { RecordsModule } from '../records/records.module';
import { TrainingCalendarModule } from '../training-calendar/training-calendar.module';
import { TrainingTrendsModule } from '../training-trends/training-trends.module';
import { TrainingConsistencyModule } from '../training-consistency/training-consistency.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    AuthModule,
    AnalyticsModule,
    BodyAnalyticsModule,
    HistoryModule,
    RecordsModule,
    TrainingCalendarModule,
    TrainingTrendsModule,
    TrainingConsistencyModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}

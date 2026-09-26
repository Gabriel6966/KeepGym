import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AccessPrincipal } from '../auth/types/auth.types';
import { AnalyticsService } from './analytics.service';
import { AnalyticsRangeQueryDto } from './dto/analytics-range-query.dto';
import { ExerciseAnalyticsQueryDto } from './dto/exercise-analytics-query.dto';
import { InvalidAnalyticsQueryError } from './errors/invalid-analytics-query.error';
import { AnalyticsInputGuard } from './guards/analytics-input.guard';

async function analyticsHttp<T>(result: Promise<T>): Promise<T> {
  try {
    return await result;
  } catch (error: unknown) {
    if (error instanceof InvalidAnalyticsQueryError)
      throw new BadRequestException(error.message);
    throw error;
  }
}
@Controller('analytics')
@UseGuards(AccessTokenGuard, AnalyticsInputGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}
  @Get('overview')
  overview(
    @CurrentUser() principal: AccessPrincipal,
    @Query() query: AnalyticsRangeQueryDto,
  ) {
    return analyticsHttp(this.analytics.overview(principal.userId, query));
  }
  @Get('exercises/:exerciseId')
  exercise(
    @CurrentUser() principal: AccessPrincipal,
    @Param('exerciseId', new ParseUUIDPipe()) exerciseId: string,
    @Query() query: ExerciseAnalyticsQueryDto,
  ) {
    return analyticsHttp(
      this.analytics.exercise(principal.userId, exerciseId, query),
    );
  }
}

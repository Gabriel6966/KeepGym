import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AccessPrincipal } from '../auth/types/auth.types';
import { BodyAnalyticsService } from './body-analytics.service';
import { BodyAnalyticsRangeQueryDto } from './dto/body-analytics-range-query.dto';
import { BodyAnalyticsTimelineQueryDto } from './dto/body-analytics-timeline-query.dto';
import { InvalidBodyAnalyticsQueryError } from './errors/invalid-body-analytics-query.error';
import { BodyAnalyticsInputGuard } from './guards/body-analytics-input.guard';

async function toHttp<T>(result: Promise<T>): Promise<T> {
  try {
    return await result;
  } catch (error: unknown) {
    if (error instanceof InvalidBodyAnalyticsQueryError)
      throw new BadRequestException(error.message);
    throw error;
  }
}
@Controller('body-analytics')
@UseGuards(AccessTokenGuard, BodyAnalyticsInputGuard)
export class BodyAnalyticsController {
  constructor(private readonly analytics: BodyAnalyticsService) {}
  @Get('overview')
  overview(
    @CurrentUser() principal: AccessPrincipal,
    @Query() query: BodyAnalyticsRangeQueryDto,
  ) {
    return toHttp(this.analytics.getOverview(principal.userId, query));
  }
  @Get('timeline')
  timeline(
    @CurrentUser() principal: AccessPrincipal,
    @Query() query: BodyAnalyticsTimelineQueryDto,
  ) {
    return toHttp(this.analytics.getTimeline(principal.userId, query));
  }
}

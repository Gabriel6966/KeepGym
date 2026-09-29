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
import { WeeklyTrainingTrendsQueryDto } from './dto/weekly-training-trends-query.dto';
import { InvalidTrainingTrendsQueryError } from './errors/invalid-training-trends-query.error';
import { TrainingTrendsInputGuard } from './guards/training-trends-input.guard';
import { TrainingTrendsService } from './training-trends.service';

@Controller('training-trends')
@UseGuards(AccessTokenGuard, TrainingTrendsInputGuard)
export class TrainingTrendsController {
  constructor(private readonly trends: TrainingTrendsService) {}

  @Get('weekly')
  async weekly(
    @CurrentUser() principal: AccessPrincipal,
    @Query() query: WeeklyTrainingTrendsQueryDto,
  ) {
    try {
      return await this.trends.getWeeklyTrends(principal.userId, query);
    } catch (error: unknown) {
      if (error instanceof InvalidTrainingTrendsQueryError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }
}

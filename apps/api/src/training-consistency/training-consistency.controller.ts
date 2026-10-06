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
import { WeeklyConsistencyQueryDto } from './dto/weekly-consistency-query.dto';
import { InvalidTrainingConsistencyQueryError } from './errors/invalid-training-consistency-query.error';
import { TrainingConsistencyInputGuard } from './guards/training-consistency-input.guard';
import { TrainingConsistencyService } from './training-consistency.service';

@Controller('training-consistency')
@UseGuards(AccessTokenGuard, TrainingConsistencyInputGuard)
export class TrainingConsistencyController {
  constructor(private readonly consistency: TrainingConsistencyService) {}

  @Get('weekly')
  async weekly(
    @CurrentUser() principal: AccessPrincipal,
    @Query() query: WeeklyConsistencyQueryDto,
  ) {
    try {
      return await this.consistency.getWeeklyConsistency(
        principal.userId,
        query,
      );
    } catch (error: unknown) {
      if (error instanceof InvalidTrainingConsistencyQueryError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }
}

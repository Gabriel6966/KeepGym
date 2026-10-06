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
import { WeeklyTrainingDurationQueryDto } from './dto/weekly-training-duration-query.dto';
import { InvalidTrainingDurationQueryError } from './errors/invalid-training-duration-query.error';
import { TrainingDurationInputGuard } from './guards/training-duration-input.guard';
import { TrainingDurationService } from './training-duration.service';

@Controller('training-duration')
@UseGuards(AccessTokenGuard, TrainingDurationInputGuard)
export class TrainingDurationController {
  constructor(private readonly duration: TrainingDurationService) {}
  @Get('weekly')
  async weekly(
    @CurrentUser() principal: AccessPrincipal,
    @Query() query: WeeklyTrainingDurationQueryDto,
  ) {
    try {
      return await this.duration.getWeeklyDuration(principal.userId, query);
    } catch (error: unknown) {
      if (error instanceof InvalidTrainingDurationQueryError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }
}

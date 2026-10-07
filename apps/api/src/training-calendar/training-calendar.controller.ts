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
import { TrainingCalendarDaysQueryDto } from './dto/training-calendar-days-query.dto';
import { InvalidTrainingCalendarQueryError } from './errors/invalid-training-calendar-query.error';
import { TrainingCalendarInputGuard } from './guards/training-calendar-input.guard';
import { TrainingCalendarService } from './training-calendar.service';

@Controller('training-calendar')
@UseGuards(AccessTokenGuard, TrainingCalendarInputGuard)
export class TrainingCalendarController {
  constructor(private readonly calendar: TrainingCalendarService) {}
  @Get('days')
  async days(
    @CurrentUser() principal: AccessPrincipal,
    @Query() query: TrainingCalendarDaysQueryDto,
  ) {
    try {
      return await this.calendar.getDays(principal.userId, query);
    } catch (error: unknown) {
      if (error instanceof InvalidTrainingCalendarQueryError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }
}

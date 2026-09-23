import {
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
import { ListWorkoutHistoryQueryDto } from './dto/list-workout-history-query.dto';
import { HistoryInputGuard } from './guards/history-input.guard';
import { HistoryService } from './history.service';
import { historyHttp } from './history.http';

@Controller('history/workouts')
@UseGuards(AccessTokenGuard, HistoryInputGuard)
export class WorkoutHistoryController {
  constructor(private readonly history: HistoryService) {}
  @Get()
  listWorkouts(
    @CurrentUser() principal: AccessPrincipal,
    @Query() query: ListWorkoutHistoryQueryDto,
  ) {
    return historyHttp(this.history.listWorkouts(principal.userId, query));
  }
  @Get(':id')
  getWorkout(
    @CurrentUser() principal: AccessPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return historyHttp(this.history.getWorkout(principal.userId, id));
  }
}

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
import { ExerciseHistoryQueryDto } from './dto/exercise-history-query.dto';
import { HistoryInputGuard } from './guards/history-input.guard';
import { HistoryService } from './history.service';
import { historyHttp } from './history.http';

@Controller('history/exercises')
@UseGuards(AccessTokenGuard, HistoryInputGuard)
export class ExerciseHistoryController {
  constructor(private readonly history: HistoryService) {}
  @Get(':exerciseId')
  getExerciseHistory(
    @CurrentUser() principal: AccessPrincipal,
    @Param('exerciseId', new ParseUUIDPipe()) exerciseId: string,
    @Query() query: ExerciseHistoryQueryDto,
  ) {
    return historyHttp(
      this.history.getExerciseHistory(principal.userId, exerciseId, query),
    );
  }
}

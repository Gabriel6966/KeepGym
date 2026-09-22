import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AccessPrincipal } from '../auth/types/auth.types';
import { WorkoutTemplateNotFoundError } from '../workout-templates/errors/workout-template-not-found.error';
import { StartWorkoutSessionDto } from './dto/start-workout-session.dto';
import { ListWorkoutSessionsQueryDto } from './dto/list-workout-sessions-query.dto';
import { EmptyWorkoutTemplateError } from './errors/empty-workout-template.error';
import { InvalidWorkoutSessionInputError } from './errors/invalid-workout-session-input.error';
import { InvalidWorkoutSessionStateError } from './errors/invalid-workout-session-state.error';
import { WorkoutSessionNotFoundError } from './errors/workout-session-not-found.error';
import { WorkoutSessionBusyError } from './errors/workout-session-busy.error';
import { WorkoutSessionInputGuard } from './guards/workout-session-input.guard';
import { WorkoutSessionsService } from './workout-sessions.service';

@Controller('workout-sessions')
@UseGuards(AccessTokenGuard, WorkoutSessionInputGuard)
export class WorkoutSessionsController {
  constructor(private readonly sessions: WorkoutSessionsService) {}

  @Post()
  start(
    @CurrentUser() principal: AccessPrincipal,
    @Body() input: StartWorkoutSessionDto,
  ) {
    return this.toHttp(this.sessions.start(principal.userId, input));
  }

  @Get()
  list(
    @CurrentUser() principal: AccessPrincipal,
    @Query() query: ListWorkoutSessionsQueryDto,
  ) {
    return this.toHttp(this.sessions.list(principal.userId, query));
  }

  @Get(':id')
  get(
    @CurrentUser() principal: AccessPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.toHttp(this.sessions.getById(principal.userId, id));
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @CurrentUser() principal: AccessPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.toHttp(this.sessions.complete(principal.userId, id));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() principal: AccessPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.toHttp(this.sessions.cancel(principal.userId, id));
  }

  private async toHttp<T>(result: Promise<T>): Promise<T> {
    try {
      return await result;
    } catch (error: unknown) {
      if (
        error instanceof WorkoutTemplateNotFoundError ||
        error instanceof WorkoutSessionNotFoundError
      )
        throw new NotFoundException(error.message);
      if (
        error instanceof EmptyWorkoutTemplateError ||
        error instanceof InvalidWorkoutSessionStateError ||
        error instanceof WorkoutSessionBusyError
      )
        throw new ConflictException(error.message);
      if (error instanceof InvalidWorkoutSessionInputError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }
}

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { CreateSetEntryDto } from './dto/create-set-entry.dto';
import { UpdateSetEntryDto } from './dto/update-set-entry.dto';
import { InvalidSetEntryError } from './errors/invalid-set-entry.error';
import { SetEntryNotFoundError } from './errors/set-entry-not-found.error';
import { WorkoutSessionExerciseNotFoundError } from './errors/workout-session-exercise-not-found.error';
import { WorkoutSessionNotEditableError } from './errors/workout-session-not-editable.error';

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

  @Post(':sessionId/exercises/:sessionExerciseId/sets')
  addSet(
    @CurrentUser() principal: AccessPrincipal,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Param('sessionExerciseId', new ParseUUIDPipe()) exerciseId: string,
    @Body() input: CreateSetEntryDto,
  ) {
    return this.toHttp(
      this.sessions.addSet(principal.userId, sessionId, exerciseId, input),
    );
  }

  @Patch(':sessionId/exercises/:sessionExerciseId/sets/:setId')
  updateSet(
    @CurrentUser() principal: AccessPrincipal,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Param('sessionExerciseId', new ParseUUIDPipe()) exerciseId: string,
    @Param('setId', new ParseUUIDPipe()) setId: string,
    @Body() input: UpdateSetEntryDto,
  ) {
    return this.toHttp(
      this.sessions.updateSet(
        principal.userId,
        sessionId,
        exerciseId,
        setId,
        input,
      ),
    );
  }

  @Delete(':sessionId/exercises/:sessionExerciseId/sets/:setId')
  @HttpCode(204)
  removeSet(
    @CurrentUser() principal: AccessPrincipal,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Param('sessionExerciseId', new ParseUUIDPipe()) exerciseId: string,
    @Param('setId', new ParseUUIDPipe()) setId: string,
  ) {
    return this.toHttp(
      this.sessions.removeSet(principal.userId, sessionId, exerciseId, setId),
    );
  }

  private async toHttp<T>(result: Promise<T>): Promise<T> {
    try {
      return await result;
    } catch (error: unknown) {
      if (
        error instanceof WorkoutTemplateNotFoundError ||
        error instanceof WorkoutSessionNotFoundError ||
        error instanceof SetEntryNotFoundError ||
        error instanceof WorkoutSessionExerciseNotFoundError
      )
        throw new NotFoundException(error.message);
      if (
        error instanceof EmptyWorkoutTemplateError ||
        error instanceof InvalidWorkoutSessionStateError ||
        error instanceof WorkoutSessionBusyError ||
        error instanceof WorkoutSessionNotEditableError
      )
        throw new ConflictException(error.message);
      if (
        error instanceof InvalidWorkoutSessionInputError ||
        error instanceof InvalidSetEntryError
      )
        throw new BadRequestException(error.message);
      throw error;
    }
  }
}

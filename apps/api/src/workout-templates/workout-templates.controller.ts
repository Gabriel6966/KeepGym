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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AccessPrincipal } from '../auth/types/auth.types';
import { ExerciseNotFoundError } from '../exercises/errors/exercise-not-found.error';
import { CreateWorkoutTemplateDto } from './dto/create-workout-template.dto';
import { UpdateWorkoutTemplateDto } from './dto/update-workout-template.dto';
import { ListWorkoutTemplatesQueryDto } from './dto/list-workout-templates-query.dto';
import { AddTemplateExerciseDto } from './dto/add-template-exercise.dto';
import { UpdateTemplateExerciseDto } from './dto/update-template-exercise.dto';
import { ReorderTemplateExercisesDto } from './dto/reorder-template-exercises.dto';
import { WorkoutTemplateQueryGuard } from './guards/workout-template-query.guard';
import { ExerciseAlreadyInTemplateError } from './errors/exercise-already-in-template.error';
import { InvalidWorkoutTemplateInputError } from './errors/invalid-workout-template-input.error';
import { TemplateExerciseNotFoundError } from './errors/template-exercise-not-found.error';
import { WorkoutTemplateNotFoundError } from './errors/workout-template-not-found.error';
import { WorkoutTemplateBusyError } from './errors/workout-template-busy.error';
import { WorkoutTemplatesService } from './workout-templates.service';

@Controller('workout-templates')
@UseGuards(AccessTokenGuard, WorkoutTemplateQueryGuard)
export class WorkoutTemplatesController {
  constructor(private readonly templates: WorkoutTemplatesService) {}

  @Post()
  create(
    @CurrentUser() principal: AccessPrincipal,
    @Body() input: CreateWorkoutTemplateDto,
  ) {
    return this.toHttp(this.templates.create(principal.userId, input));
  }

  @Get()
  list(
    @CurrentUser() principal: AccessPrincipal,
    @Query() query: ListWorkoutTemplatesQueryDto,
  ) {
    return this.toHttp(this.templates.list(principal.userId, query));
  }

  @Get(':id')
  get(
    @CurrentUser() principal: AccessPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.toHttp(this.templates.getById(principal.userId, id));
  }

  @Patch(':id')
  update(
    @CurrentUser() principal: AccessPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateWorkoutTemplateDto,
  ) {
    return this.toHttp(this.templates.update(principal.userId, id, input));
  }

  @Delete(':id')
  @HttpCode(204)
  archive(
    @CurrentUser() principal: AccessPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.toHttp(this.templates.archive(principal.userId, id));
  }

  @Post(':id/exercises')
  addExercise(
    @CurrentUser() principal: AccessPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: AddTemplateExerciseDto,
  ) {
    return this.toHttp(this.templates.addExercise(principal.userId, id, input));
  }

  @Patch(':id/exercises/:templateExerciseId')
  updateExercise(
    @CurrentUser() principal: AccessPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('templateExerciseId', new ParseUUIDPipe()) childId: string,
    @Body() input: UpdateTemplateExerciseDto,
  ) {
    return this.toHttp(
      this.templates.updateExercise(principal.userId, id, childId, input),
    );
  }

  @Delete(':id/exercises/:templateExerciseId')
  @HttpCode(204)
  removeExercise(
    @CurrentUser() principal: AccessPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('templateExerciseId', new ParseUUIDPipe()) childId: string,
  ) {
    return this.toHttp(
      this.templates.removeExercise(principal.userId, id, childId),
    );
  }

  @Put(':id/exercises/order')
  reorder(
    @CurrentUser() principal: AccessPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: ReorderTemplateExercisesDto,
  ) {
    return this.toHttp(
      this.templates.reorder(principal.userId, id, input.templateExerciseIds),
    );
  }

  private async toHttp<T>(result: Promise<T>): Promise<T> {
    try {
      return await result;
    } catch (error: unknown) {
      if (
        error instanceof WorkoutTemplateNotFoundError ||
        error instanceof TemplateExerciseNotFoundError ||
        error instanceof ExerciseNotFoundError
      )
        throw new NotFoundException(error.message);
      if (
        error instanceof ExerciseAlreadyInTemplateError ||
        error instanceof WorkoutTemplateBusyError
      )
        throw new ConflictException(error.message);
      if (error instanceof InvalidWorkoutTemplateInputError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }
}

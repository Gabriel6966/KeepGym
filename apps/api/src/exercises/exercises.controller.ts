import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { ListExercisesQueryDto } from './dto/list-exercises-query.dto';
import { ExerciseNotFoundError } from './errors/exercise-not-found.error';
import { InvalidExerciseQueryError } from './errors/invalid-exercise-query.error';
import { ExercisesService } from './exercises.service';
import type { ExercisePage, PublicExercise } from './exercises.types';

@Controller('exercises')
@UseGuards(AccessTokenGuard)
export class ExercisesController {
  constructor(private readonly exercises: ExercisesService) {}

  @Get()
  async list(@Query() query: ListExercisesQueryDto): Promise<ExercisePage> {
    try {
      return await this.exercises.list(query);
    } catch (error: unknown) {
      if (error instanceof InvalidExerciseQueryError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }

  @Get(':id')
  async getById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: Record<string, unknown>,
  ): Promise<PublicExercise> {
    if (Object.keys(query).length > 0)
      throw new BadRequestException(
        'Exercise detail does not accept query parameters.',
      );
    try {
      return await this.exercises.getById(id);
    } catch (error: unknown) {
      if (error instanceof ExerciseNotFoundError)
        throw new NotFoundException(error.message);
      if (error instanceof InvalidExerciseQueryError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }
}

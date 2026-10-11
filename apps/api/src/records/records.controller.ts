import {
  BadRequestException,
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
import { RecordsService } from './records.service';
import { RecordsInputGuard } from './guards/records-input.guard';
import { InvalidRecordsQueryError } from './errors/invalid-records-query.error';
import { CurrentRecordsQueryDto } from './dto/current-records-query.dto';

@Controller('records')
@UseGuards(AccessTokenGuard, RecordsInputGuard)
export class RecordsController {
  constructor(private readonly records: RecordsService) {}

  @Get('current')
  async getCurrentRecords(
    @CurrentUser() principal: AccessPrincipal,
    @Query() query: CurrentRecordsQueryDto,
  ) {
    try {
      return await this.records.getCurrentRecords(
        principal.userId,
        query.limit,
      );
    } catch (error: unknown) {
      if (error instanceof InvalidRecordsQueryError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }

  @Get('exercises/:exerciseId')
  async getExerciseRecords(
    @CurrentUser() principal: AccessPrincipal,
    @Param('exerciseId', new ParseUUIDPipe()) exerciseId: string,
  ) {
    try {
      return await this.records.getExerciseRecords(
        principal.userId,
        exerciseId,
      );
    } catch (error: unknown) {
      if (error instanceof InvalidRecordsQueryError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }
}

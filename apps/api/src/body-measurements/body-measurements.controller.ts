import {
  BadRequestException,
  Body,
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
import { BodyMeasurementsService } from './body-measurements.service';
import { CreateBodyMeasurementDto } from './dto/create-body-measurement.dto';
import { UpdateBodyMeasurementDto } from './dto/update-body-measurement.dto';
import { ListBodyMeasurementsQueryDto } from './dto/list-body-measurements-query.dto';
import { BodyMeasurementNotFoundError } from './errors/body-measurement-not-found.error';
import { InvalidBodyMeasurementError } from './errors/invalid-body-measurement.error';
import { BodyMeasurementInputGuard } from './guards/body-measurement-input.guard';

async function toHttp<T>(result: Promise<T>): Promise<T> {
  try {
    return await result;
  } catch (error: unknown) {
    if (error instanceof BodyMeasurementNotFoundError)
      throw new NotFoundException(error.message);
    if (error instanceof InvalidBodyMeasurementError)
      throw new BadRequestException(error.message);
    throw error;
  }
}

@Controller('body-measurements')
@UseGuards(AccessTokenGuard, BodyMeasurementInputGuard)
export class BodyMeasurementsController {
  constructor(private readonly measurements: BodyMeasurementsService) {}

  @Post()
  create(
    @CurrentUser() principal: AccessPrincipal,
    @Body() input: CreateBodyMeasurementDto,
  ) {
    return toHttp(this.measurements.create(principal.userId, input));
  }

  @Get()
  list(
    @CurrentUser() principal: AccessPrincipal,
    @Query() query: ListBodyMeasurementsQueryDto,
  ) {
    return toHttp(this.measurements.list(principal.userId, query));
  }

  @Get(':id')
  getById(
    @CurrentUser() principal: AccessPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return toHttp(this.measurements.getById(principal.userId, id));
  }

  @Patch(':id')
  update(
    @CurrentUser() principal: AccessPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateBodyMeasurementDto,
  ) {
    return toHttp(this.measurements.update(principal.userId, id, input));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() principal: AccessPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return toHttp(this.measurements.remove(principal.userId, id));
  }
}

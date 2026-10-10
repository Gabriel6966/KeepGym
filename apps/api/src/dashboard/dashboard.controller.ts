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
import { DashboardSummaryQueryDto } from './dto/dashboard-summary-query.dto';
import { InvalidDashboardQueryError } from './errors/invalid-dashboard-query.error';
import { DashboardInputGuard } from './guards/dashboard-input.guard';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(AccessTokenGuard, DashboardInputGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  async summary(
    @CurrentUser() principal: AccessPrincipal,
    @Query() query: DashboardSummaryQueryDto,
  ) {
    try {
      return await this.dashboard.getSummary(principal.userId, query);
    } catch (error: unknown) {
      if (error instanceof InvalidDashboardQueryError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }
}

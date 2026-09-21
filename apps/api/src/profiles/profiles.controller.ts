import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AccessPrincipal } from '../auth/types/auth.types';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileQueryGuard } from './guards/profile-query.guard';
import { InvalidProfileInputError } from './errors/invalid-profile-input.error';
import { ProfileAlreadyExistsError } from './errors/profile-already-exists.error';
import { ProfileNotFoundError } from './errors/profile-not-found.error';
import { ProfilesService } from './profiles.service';
import type { PublicProfile } from './profiles.types';

@Controller('profile')
@UseGuards(AccessTokenGuard, ProfileQueryGuard)
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Post()
  create(
    @CurrentUser() principal: AccessPrincipal,
    @Body() input: CreateProfileDto,
  ): Promise<PublicProfile> {
    return this.toHttpResult(this.profiles.create(principal.userId, input));
  }

  @Get()
  get(@CurrentUser() principal: AccessPrincipal): Promise<PublicProfile> {
    return this.toHttpResult(this.profiles.getByUserId(principal.userId));
  }

  @Patch()
  update(
    @CurrentUser() principal: AccessPrincipal,
    @Body() input: UpdateProfileDto,
  ): Promise<PublicProfile> {
    return this.toHttpResult(this.profiles.update(principal.userId, input));
  }

  private async toHttpResult(
    result: Promise<PublicProfile>,
  ): Promise<PublicProfile> {
    try {
      return await result;
    } catch (error: unknown) {
      if (error instanceof ProfileAlreadyExistsError)
        throw new ConflictException(error.message);
      if (error instanceof ProfileNotFoundError)
        throw new NotFoundException(error.message);
      if (error instanceof InvalidProfileInputError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }
}

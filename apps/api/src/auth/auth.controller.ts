import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { UserEmailAlreadyExistsError } from '../users/errors/user-email-already-exists.error';
import type { PublicUser } from '../users/users.types';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { InvalidCredentialsError } from './errors/invalid-credentials.error';
import { AccessTokenGuard } from './guards/access-token.guard';
import type { AccessPrincipal, AuthResponse } from './types/auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() input: RegisterDto): Promise<AuthResponse> {
    try {
      return await this.authService.register(input);
    } catch (error: unknown) {
      if (error instanceof UserEmailAlreadyExistsError) {
        throw new ConflictException('Email already exists');
      }
      throw error;
    }
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() input: LoginDto): Promise<AuthResponse> {
    try {
      return await this.authService.login(input);
    } catch (error: unknown) {
      if (error instanceof InvalidCredentialsError) {
        throw new UnauthorizedException('Invalid credentials');
      }
      throw error;
    }
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  async me(@CurrentUser() principal: AccessPrincipal): Promise<PublicUser> {
    const user = await this.authService.findCurrentUser(principal.userId);
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}

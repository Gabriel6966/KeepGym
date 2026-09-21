import {
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { InvalidRefreshTokenError } from '../sessions/errors/invalid-refresh-token.error';
import { UserEmailAlreadyExistsError } from '../users/errors/user-email-already-exists.error';
import type { PublicUser } from '../users/users.types';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { InvalidCredentialsError } from './errors/invalid-credentials.error';
import { AccessTokenGuard } from './guards/access-token.guard';
import { OriginGuard } from './guards/origin.guard';
import { RefreshCookieService } from './refresh-cookie.service';
import type { AccessPrincipal, AuthResponse } from './types/auth.types';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly refreshCookie: RefreshCookieService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(OriginGuard)
  @Header('Cache-Control', 'no-store')
  async register(
    @Body() input: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    try {
      const result = await this.authService.register(input);
      this.refreshCookie.set(response, result.session);
      return result.response;
    } catch (error: unknown) {
      if (error instanceof UserEmailAlreadyExistsError) {
        throw new ConflictException('Email already exists');
      }
      throw error;
    }
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OriginGuard)
  @Header('Cache-Control', 'no-store')
  async login(
    @Body() input: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    try {
      const result = await this.authService.login(input);
      this.refreshCookie.set(response, result.session);
      return result.response;
    } catch (error: unknown) {
      if (error instanceof InvalidCredentialsError) {
        throw new UnauthorizedException('Invalid credentials');
      }
      throw error;
    }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OriginGuard)
  @Header('Cache-Control', 'no-store')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    try {
      const result = await this.authService.refresh(
        this.refreshCookie.read(request),
      );
      this.refreshCookie.set(response, result.session);
      return result.response;
    } catch (error: unknown) {
      if (error instanceof InvalidRefreshTokenError) {
        this.refreshCookie.clear(response);
        throw new UnauthorizedException('Invalid refresh token');
      }
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(OriginGuard)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    try {
      await this.authService.logout(this.refreshCookie.read(request));
    } finally {
      this.refreshCookie.clear(response);
    }
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AccessTokenGuard, OriginGuard)
  async logoutAll(
    @CurrentUser() principal: AccessPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    try {
      await this.authService.logoutAll(principal.userId);
    } finally {
      this.refreshCookie.clear(response);
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

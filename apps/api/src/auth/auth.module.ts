import { Module } from '@nestjs/common';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import {
  environmentConfig,
  type EnvironmentConfig,
} from '../config/environment.config';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessTokenGuard } from './guards/access-token.guard';
import { PasswordHasher } from './password-hasher.service';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [environmentConfig.KEY],
      useFactory: (config: EnvironmentConfig): JwtModuleOptions => ({
        secret: config.jwtAccessSecret,
        signOptions: {
          algorithm: 'HS256',
          expiresIn: config.jwtAccessTtlSeconds,
        },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordHasher, AccessTokenGuard],
})
export class AuthModule {}

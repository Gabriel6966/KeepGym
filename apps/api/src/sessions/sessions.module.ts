import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RefreshTokenService } from './refresh-token.service';
import { SessionsRepository } from './sessions.repository';
import { SessionsService } from './sessions.service';

@Module({
  imports: [PrismaModule],
  providers: [RefreshTokenService, SessionsRepository, SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}

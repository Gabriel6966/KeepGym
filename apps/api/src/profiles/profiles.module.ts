import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProfilesController } from './profiles.controller';
import { ProfilesRepository } from './profiles.repository';
import { ProfilesService } from './profiles.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ProfilesController],
  providers: [ProfilesRepository, ProfilesService],
})
export class ProfilesModule {}

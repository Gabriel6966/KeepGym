import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RecordsController } from './records.controller';
import { RecordsRepository } from './records.repository';
import { RecordsService } from './records.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [RecordsController],
  providers: [RecordsRepository, RecordsService],
})
export class RecordsModule {}

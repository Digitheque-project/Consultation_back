import { Module } from '@nestjs/common';
import { MedecinsService } from './medecins.service';
import { MedecinsController } from './medecins.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [MedecinsController],
  providers: [MedecinsService],
  exports: [MedecinsService],
})
export class MedecinsModule {}
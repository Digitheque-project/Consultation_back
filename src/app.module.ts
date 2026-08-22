import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ConsultationsModule } from './consultations/consultations.module';
import { PlanningModule } from './planning/planning.module';
import { MedecinsModule } from './medecins/medecins.module';
import { PharmacieModule } from './pharmacie/pharmacie.module';
import { PrescriptionModule } from './prescription/prescription.module';
import { AuthModule } from './auth/auth.module';
import { JwtGuard } from './auth/jwt.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    AuthModule,
    ConsultationsModule,
    PlanningModule,
    MedecinsModule,
    PharmacieModule,
    PrescriptionModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtGuard,
    },
  ],
})
export class AppModule {}

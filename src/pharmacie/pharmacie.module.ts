import { Module } from '@nestjs/common';
import { PharmacieController } from './pharmacie.controller';
import { PharmacieService } from './pharmacie.service';

@Module({
  controllers: [PharmacieController],
  providers: [PharmacieService],
})
export class PharmacieModule {}

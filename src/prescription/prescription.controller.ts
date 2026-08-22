import { All, Controller, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PrescriptionService } from './prescription.service';

// Exclu du Swagger : c'est un relais générique (n'importe quel chemin, toute
// méthode), pas un ensemble de routes documentables individuellement — la
// vraie documentation reste celle du service prescription lui-même.
//
// Pas de @Public() : hérite du JwtGuard global, comme le reste de l'API —
// cohérent avec ce que le frontend envoyait déjà directement à prescription.
@ApiExcludeController()
@Controller('prescription')
export class PrescriptionController {
  constructor(private readonly prescriptionService: PrescriptionService) {}

  // Syntaxe *path exigée par path-to-regexp (Express 5 / NestJS 11) pour un
  // segment générique — voir legacy-route-converter.js dans @nestjs/core.
  @All('*path')
  async proxy(@Req() req: Request, @Res() res: Response) {
    await this.prescriptionService.forward(req, res);
  }
}

import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PharmacieService } from './pharmacie.service';

// Pas de @Public() : ce relais hérite du JwtGuard global (APP_GUARD), donc
// exige le même token médecin que le reste de l'API — cohérent avec ce que
// le frontend envoyait déjà à la pharmacie directement.
@ApiTags('pharmacie')
@Controller('pharmacie')
export class PharmacieController {
  constructor(private readonly pharmacieService: PharmacieService) {}

  @Get('articles/stock-sale-prices')
  @ApiOperation({
    summary: 'Catalogue pharmacie (stock + prix), relayé serveur-à-serveur',
    description:
      "Relais vers le service pharmacie — évite l'appel direct depuis le navigateur, bloqué par CORS côté pharmacie (aucun en-tête Access-Control-Allow-Origin). Dégradable : retourne un tableau vide si le service pharmacie est indisponible ou non configuré.",
  })
  @ApiQuery({ name: 'chuId', required: false, description: 'Identifiant du CHU' })
  @ApiResponse({ status: 200, description: 'Catalogue pharmacie (ou tableau vide si indisponible)' })
  async getArticlesStockSalePrices(@Query('chuId') chuId?: string) {
    return this.pharmacieService.getArticlesStockSalePrices(chuId);
  }
}

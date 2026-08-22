import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { NotificationService } from './notification.service';

// @Public() ici, à la différence de pharmacie et prescription : l'appel
// direct au service notification n'envoyait jamais de token (route publique
// côté service notification, confirmé — CORS ouvert, 200 sans Authorization).
// Le relais doit reproduire ce comportement à l'identique, pas en ajouter.
@ApiTags('notification')
@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Public()
  @Get('notifications/user/:userId')
  @ApiOperation({
    summary: "Historique des notifications d'un utilisateur, relayé serveur-à-serveur",
    description:
      "Relais vers le service notification. Contrairement à pharmacie et prescription, le service notification a bien du CORS configuré (Access-Control-Allow-Origin: *) — ce relais existe uniquement pour retirer une variable NEXT_PUBLIC_* de plus du frontend, pas pour contourner un blocage.",
  })
  @ApiParam({ name: 'userId', description: "Identifiant de l'utilisateur (médecin)" })
  @ApiResponse({ status: 200, description: 'Historique des notifications (ou tableau vide si indisponible)' })
  async getUserNotifications(@Param('userId') userId: string) {
    return this.notificationService.getUserNotifications(userId);
  }
}

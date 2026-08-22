import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import { io as connectUpstream, type Socket as UpstreamSocket } from 'socket.io-client';
import type { Socket } from 'socket.io';

const NOTIFICATION_URL = process.env.NOTIFICATION_URL;

/**
 * Relais WebSocket temps réel vers le service notification.
 *
 * Contrairement au relais REST (notification.service.ts), un simple appel
 * fetch() ne suffit pas ici : la connexion est bidirectionnelle et
 * persistante. Pour chaque navigateur qui se connecte à NOUS, on ouvre une
 * connexion montante DÉDIÉE vers le vrai service notification, avec les
 * mêmes paramètres d'authentification (userId, serviceId) — et on relaie
 * chaque événement "notification" reçu vers ce client précis. Une connexion
 * amont par client (pas une seule partagée) : le service notification route
 * ses messages par utilisateur via ces paramètres, on ne peut pas deviner
 * sa logique de "room" interne sans la dupliquer — le relais 1:1 la
 * préserve sans avoir à la connaître.
 *
 * Monté sur le même port que le reste de l'API (pas de préfixe
 * "consultation/api" : setGlobalPrefix ne s'applique qu'aux routes HTTP,
 * jamais aux gateways WebSocket côté NestJS).
 */
@WebSocketGateway({ namespace: 'notifications', cors: { origin: true } })
export class NotificationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationGateway.name);
  private readonly upstreamByClient = new Map<string, UpstreamSocket>();

  handleConnection(client: Socket) {
    if (!NOTIFICATION_URL) {
      this.logger.warn('NOTIFICATION_URL non configurée — relais WebSocket indisponible.');
      client.disconnect(true);
      return;
    }

    const auth = (client.handshake.auth ?? {}) as { userId?: string; serviceId?: string };
    const upstream = connectUpstream(`${NOTIFICATION_URL}/notifications`, {
      transports: ['websocket', 'polling'],
      auth: {
        ...(auth.userId ? { userId: auth.userId } : {}),
        ...(auth.serviceId ? { serviceId: auth.serviceId } : {}),
      },
    });

    upstream.on('connect', () => {
      this.logger.debug(`Connexion amont établie pour le client ${client.id}`);
    });
    upstream.on('notification', (payload: unknown) => {
      client.emit('notification', payload);
    });
    upstream.on('connect_error', (err: Error) => {
      this.logger.warn(`Connexion amont notification en échec pour ${client.id}: ${err.message}`);
    });

    this.upstreamByClient.set(client.id, upstream);
  }

  handleDisconnect(client: Socket) {
    const upstream = this.upstreamByClient.get(client.id);
    if (upstream) {
      upstream.disconnect();
      this.upstreamByClient.delete(client.id);
    }
  }
}

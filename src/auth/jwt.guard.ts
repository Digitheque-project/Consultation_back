import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AuthService } from './auth.service';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request?.headers?.authorization;
    const [, token] = authHeader?.split(' ') ?? [];

    // Endpoints publics : on tente de peupler req.user si un token est fourni,
    // mais on laisse toujours passer (pas de blocage si token absent/invalide).
    if (isPublic) {
      if (token) {
        const user = this.authService.validateServiceToken(token) ?? (await this.authService.validateToken(token));
        if (user) request.user = user;
      }
      return true;
    }

    // Endpoints protégés : token obligatoire
    if (!authHeader) throw new UnauthorizedException('Token manquant.');

    // Appel d'un autre service du CHU : JWT role=SERVICE signé avec le
    // JWT_SECRET partagé (voir service-token.ts).
    const service = this.authService.validateServiceToken(token ?? '');
    if (service) {
      request.user = service;
      return true;
    }

    const user = await this.authService.validateToken(token ?? '');
    if (!user) throw new UnauthorizedException('Token invalide ou expiré.');

    request.user = user;
    return true;
  }
}

import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Validé au démarrage (config/assert-env.ts) — jamais de secret par défaut.
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  async validate(payload: any) {
    // Supporte { userId } (service auth externe) et { sub } (ancien format)
    const userId = payload.userId ?? String(payload.sub);
    return { userId, medecinId: payload.medecinId, email: payload.email, role: payload.role, chuId: payload.chuId };
  }
}

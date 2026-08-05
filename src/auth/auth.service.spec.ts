import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { medecinCache: { upsert: jest.Mock } };
  const jwtService = { verify: jest.fn().mockImplementation(() => { throw new Error('invalid'); }) } as unknown as JwtService;

  beforeEach(() => {
    prisma = {
      medecinCache: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    service = new AuthService(prisma as any, jwtService);
  });

  it('retourne null pour un token malformé', async () => {
    const result = await service.validateToken('not-a-jwt');
    expect(result).toBeNull();
  });

  it('construit le profil directement depuis un token JWT valide (aucune lecture en base) et alimente le cache d\'affichage', async () => {
    const uuid = 'c2ded010-e37a-4ec1-bf93-4712393ba231';
    (jwtService.verify as jest.Mock).mockReturnValue({
      userId: uuid,
      name: 'Durand',
      firstname: 'Jean',
      email: 'j.durand@chu.mg',
      services: [],
    });

    const result = await service.validateToken('a-valid-token');
    expect(result?.nom).toBe('Durand');
    expect(result?.medecinId).toBe(uuid);
    expect(prisma.medecinCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: uuid } }),
    );
  });
});

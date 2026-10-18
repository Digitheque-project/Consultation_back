import { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtGuard } from './jwt.guard';
import { AuthService } from './auth.service';

describe('JwtGuard', () => {
  const secret = 'test-secret';
  const jwtService = new JwtService({ secret });
  const authService = new AuthService({} as any, jwtService);

  function contextFor(authorization?: string) {
    const req: any = { headers: authorization ? { authorization } : {} };
    const context = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    return { req, context };
  }

  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as any;

  it('accepte un JWT de service (role=SERVICE) signé avec le secret partagé', async () => {
    const guard = new JwtGuard(reflector, authService);
    const token = jwtService.sign({ userId: 'service-accueil', role: 'SERVICE' }, { expiresIn: '2m' });
    const { req, context } = contextFor(`Bearer ${token}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toEqual(expect.objectContaining({ role: 'SERVICE', userId: 'service-accueil', medecinId: null }));
  });

  it('refuse un JWT de service signé avec un autre secret', async () => {
    const guard = new JwtGuard(reflector, authService);
    const forged = new JwtService({ secret: 'autre-secret' }).sign({ userId: 'x', role: 'SERVICE', exp: Math.floor(Date.now() / 1000) - 10 });
    const { context } = contextFor(`Bearer ${forged}`);

    await expect(guard.canActivate(context)).rejects.toThrow('Token invalide ou expiré.');
  });

  it("refuse l'ancien secret statique (plus de SERVICE_API_TOKEN)", async () => {
    const guard = new JwtGuard(reflector, authService);
    const { context } = contextFor('Bearer dev-service-token-accueil-only');

    await expect(guard.canActivate(context)).rejects.toThrow('Token invalide ou expiré.');
  });
});

import { ExecutionContext } from '@nestjs/common';
import { JwtGuard } from './jwt.guard';

describe('JwtGuard', () => {
  const originalServiceToken = process.env.SERVICE_API_TOKEN;

  afterEach(() => {
    if (originalServiceToken === undefined) {
      delete process.env.SERVICE_API_TOKEN;
    } else {
      process.env.SERVICE_API_TOKEN = originalServiceToken;
    }
  });

  it('allows service requests when a matching service token is provided', async () => {
    process.env.SERVICE_API_TOKEN = 'service-secret';

    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as any;
    const authService = { validateToken: jest.fn() } as any;
    const guard = new JwtGuard(reflector, authService);
    const req: any = {
      headers: {
        authorization: 'Bearer service-secret',
      },
    };

    const context = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toEqual(
      expect.objectContaining({
        role: 'SERVICE',
      }),
    );
  });
});

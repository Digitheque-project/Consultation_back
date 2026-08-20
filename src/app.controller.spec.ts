import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it("retourne le message d'accueil du CHU", () => {
      expect(appController.getHello()).toBe(
        "Bienvenue sur l'API du CHU Andrainjato Fianarantsoa",
      );
    });
  });

  describe('health', () => {
    it('renvoie "ok" quand la base répond', async () => {
      await expect(appController.health()).resolves.toEqual({
        status: 'ok',
        database: 'up',
      });
    });

    // Le cas qui compte réellement : sans 503, un orchestrateur router du
    // trafic vers un conteneur dont la base est morte (cf. panne constatée).
    it('lève une 503 quand la base est injoignable', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error("Can't reach database server"));

      await expect(appController.health()).rejects.toMatchObject({
        status: 503,
      });
    });

    // Prisma n'échoue pas toujours vite : base injoignable, il attend son
    // propre délai de connexion (>90 s constatés en production). Sans borne,
    // la sonde pend et la supervision ne peut plus rien conclure.
    it('lève une 503 sans attendre quand la base ne répond jamais', async () => {
      jest.useFakeTimers();
      prisma.$queryRaw.mockReturnValue(new Promise(() => {})); // ne se résout jamais

      const promesse = appController.health();
      const attendu = expect(promesse).rejects.toMatchObject({ status: 503 });
      await jest.advanceTimersByTimeAsync(6000);
      await attendu;

      jest.useRealTimers();
    });
  });
});

import './config/assert-env';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  // Import dynamique (pas statique en tête de fichier) : AppModule importe en
  // cascade consultations.service.ts et consorts, qui lisent process.env.CHU_ID
  // (et consorts) au chargement du module — il faut donc que resolveIdentityEnvVars()
  // ait fini d'écrire ces valeurs dans process.env AVANT que ce import ne soit
  // exécuté, ce qu'un import statique en haut de fichier ne permettrait pas
  // (tous les imports statiques s'exécutent avant le corps de bootstrap()).
  const { resolveIdentityEnvVars } = await import('./config/resolve-identity.js');
  await resolveIdentityEnvVars();

  const { AppModule } = await import('./app.module.js');
  const app = await NestFactory.create(AppModule);
  const apiPrefix = process.env.API_PREFIX || 'consultation/api';

  app.setGlobalPrefix(apiPrefix);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Configuration Swagger public
  const swaggerPath = `${apiPrefix}/docs`;
  const openApiPath = `${apiPrefix}/docs-json`;

  const config = new DocumentBuilder()
    .setTitle('CHU Andrainjato Fianarantsoa - API')
    .setDescription('Documentation Swagger publique de l’API consultation externe du CHU Andrainjato Fianarantsoa. Cette documentation est accessible librement par les services tiers pour découvrir les endpoints, les modèles et les exemples d’appels.\n\nLes routes protégées restent sécurisées côté backend, mais la documentation et le schéma OpenAPI sont exposés publiquement.')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        in: 'header',
      },
      'access-token',
    )
    .addTag('consultations', 'Gestion des consultations médicales')
    .addTag('planning', 'Gestion des créneaux de disponibilité et du planning médical')
    .addTag('patients', 'Gestion des patients')
    .addTag('medecins', 'Gestion des médecins')
    .addTag('Auth', 'Authentification et connexion des utilisateurs')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  app.getHttpAdapter().get(openApiPath, (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(document);
  });

  SwaggerModule.setup(swaggerPath, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      filter: true,
      tryItOutEnabled: true,
    },
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info .title { color: #2563eb }
    `,
    customSiteTitle: 'CHU Andrainjato Fianarantsoa - API Documentation',
  });

  // ─── Swagger unifié pour tous les services externes ─────────────────────────
  // Accessible sur /consultation/api/externe/docs
  // Inclut tous les endpoints publics utiles à l'accueil et au service clinique.
  const externalSwaggerPath = `${apiPrefix}/externe/docs`;
  const externalConfig = new DocumentBuilder()
    .setTitle('CHU Andrainjato — API Services Externes')
    .setDescription(
      '**Documentation unifiée** pour tous les services tiers qui interagissent avec le module Consultation Externe.\n\n' +
      '> **Tous les endpoints listés ici sont publics (aucun token requis)** sauf indication contraire.\n\n' +
      '---\n\n' +
      '### 🏥 Service Accueil\n' +
      'Endpoints à utiliser par le service accueil hospitalier :\n' +
      '- **`GET /medecins`** — liste des médecins de consultation externe (avec leur UUID)\n' +
      '- **`GET /planning/medecin/{id}`** — planning d\'un médecin pour choisir un créneau disponible\n' +
      '- **`POST /consultations`** — créer un rendez-vous patient → médecin\n' +
      '- **`GET /consultations/accueil/rendez-vous?chuId=...`** — lister **tous** les rendez-vous du CHU (actifs ou archivés, avec filtres date)\n' +
      '- **`POST /consultations/{id}/arrival`** — confirmer l\'arrivée physique d\'un patient (déclenche la vue "Arrivé" chez le médecin)\n' +
      '- **`GET /consultations/accueil/requests`** — demandes d\'examen/hospitalisation en attente\n' +
      '- **`POST /consultations/accueil/requests/{id}/reponse`** — valider ou refuser une demande\n\n' +
      '---\n\n' +
      '### 🏨 Service Clinique (post-hospitalisation)\n' +
      '- **`POST /consultations/externe/controle`** — orienter un patient sortant vers une consultation de contrôle\n\n' +
      '---\n\n' +
      '**⚠️ Changement important :** Les identifiants médecin (`medecinId`) sont désormais des **UUID string** ' +
      '(ex: `bb2ff11e-0e8b-4ea5-a120-ed4c55d07909`), plus des entiers. ' +
      'Récupérez les UUID via `GET /medecins` avant de créer une consultation.',
    )
    .setVersion('1.0')
    .addTag('accueil', 'Endpoints pour le service accueil hospitalier')
    .addTag('service-clinique', 'Endpoint pour le service clinique (post-hospitalisation)')
    .build();

  const fullExternalDoc = SwaggerModule.createDocument(app, externalConfig);

  // Filtrer : conserver uniquement les opérations taggées 'accueil' ou 'service-clinique'
  const EXTERNAL_TAGS = new Set(['accueil', 'service-clinique']);
  const filteredPaths = Object.fromEntries(
    Object.entries(fullExternalDoc.paths as Record<string, Record<string, { tags?: string[] }>>)
      .map(([path, methods]) => [
        path,
        Object.fromEntries(
          Object.entries(methods).filter(
            ([, op]) => Array.isArray(op?.tags) && op.tags.some((t: string) => EXTERNAL_TAGS.has(t)),
          ),
        ),
      ])
      .filter(([, methods]) => Object.keys(methods).length > 0),
  );

  // Conserver les schemas utilisés par les endpoints externes
  const usedSchemas = ['CreateConsultationDto', 'CreateControleExterneDto'];
  const allSchemas = (fullExternalDoc.components?.schemas ?? {}) as Record<string, any>;
  const filteredComponents = {
    ...fullExternalDoc.components,
    schemas: Object.fromEntries(
      Object.entries(allSchemas).filter(([name]) => usedSchemas.includes(name)),
    ) as Record<string, any>,
  };
  const externalDoc = { ...fullExternalDoc, paths: filteredPaths, components: filteredComponents };

  SwaggerModule.setup(externalSwaggerPath, app, externalDoc, {
    swaggerOptions: {
      tryItOutEnabled: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      defaultModelsExpandDepth: 3,
      tagsSorter: 'alpha',
    },
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info .title { color: #0369a1; font-size: 1.8rem; font-weight: 800 }
      .swagger-ui .info .description p { font-size: 0.95rem; line-height: 1.6 }
      .swagger-ui .info .description h3 { font-size: 1.1rem; font-weight: 700; margin-top: 1rem }
    `,
    customSiteTitle: 'CHU Andrainjato — API Services Externes',
  });

  const port = process.env.BACKEND_PORT ?? 3333;
  await app.listen(port);
  console.log(`Backend running on http://localhost:${port}`);
  console.log(`Swagger (interne)  : http://localhost:${port}/${swaggerPath}`);
  console.log(`Swagger (externe)  : http://localhost:${port}/${externalSwaggerPath}`);
  console.log(`OpenAPI JSON       : http://localhost:${port}/${openApiPath}`);
}
bootstrap();

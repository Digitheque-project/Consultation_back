# CHU Andrainjato Fianarantsoa - API Documentation

## Vue d'ensemble

Cette API fournit les services backend pour le système de consultation externe du CHU Andrainjato Fianarantsoa.

## Technologies utilisées

- **Framework**: NestJS
- **Base de données**: PostgreSQL avec Prisma ORM
- **Documentation**: Swagger/OpenAPI
- **Authentification**: JWT (à implémenter)

## Démarrage

```bash
# Installation des dépendances
npm install

# Configuration de la base de données
npx prisma migrate dev
npx prisma generate

# Démarrage en mode développement
npm run start:dev
```

## Documentation API

Une fois le serveur démarré, la documentation Swagger est disponible à l'adresse :

**http://localhost:3333/api**

### Fonctionnalités de la documentation

- **Interface interactive**: Testez les endpoints directement depuis le navigateur
- **Schémas détaillés**: Description complète des modèles de données
- **Exemples de requêtes**: Payloads et réponses d'exemple
- **Authentification persistante**: Conservation des tokens d'authentification

## Endpoints principaux

### Consultations

- `GET /consultations` - Liste de toutes les consultations
- `GET /consultations/waiting-prescription` - Consultations en attente de prescription
- `GET /consultations/:id` - Détails d'une consultation spécifique
- `POST /consultations/:id/finalize` - Finaliser une consultation avec prescriptions

### Points d'entrée

- `GET /` - Message de bienvenue de l'API

## Modèles de données

### Consultation
```typescript
{
  id: number;
  date: string; // ISO date string
  heure: string; // HH:MM format
  patientId: number;
  medecinId: number;
  statut: string;
  urgence: boolean;
  termine: boolean;
  motif?: string;
  observation?: {
    id: number;
    consultationId: number;
    diagnostic: string;
    notes: string;
  };
  medicamentPrescriptions?: Array<{
    id: number;
    consultationId: number;
    medicament: string;
    forme: string;
    dosage: string;
    voie: string;
    posologie: string;
    duree: string;
    instructions: string;
  }>;
  nonMedicamentPrescriptions?: Array<{
    recommandationsNotes?: string;
    rdvMotif?: string;
    rdvNiveau?: 'NIVEAU_1' | 'NIVEAU_2' | 'NIVEAU_3' | 'NIVEAU_4';
    rdvDate?: string;
    examenService?: string;
    examenMotif?: string;
    examenPriorite?: 'STAT' | 'URGENTE' | 'NORMALE';
    hospitalisationMotif?: string;
    hospitalisationService?: string;
    hospitalisationStatus?: 'EN_ATTENTE' | 'VALIDE' | 'REFUSE';
  }>;
}
```

## Variables d'environnement

```env
DATABASE_URL="postgresql://username:password@localhost:5432/chu_db"
BACKEND_PORT=3333
JWT_SECRET="your-secret-key"
```

## Scripts disponibles

- `npm run start:dev` - Démarrage en mode développement avec hot-reload
- `npm run build` - Compilation du projet
- `npm run start:prod` - Démarrage en mode production
- `npm run prisma:migrate` - Exécution des migrations de base de données
- `npm run prisma:generate` - Génération du client Prisma

## Développement

### Ajout de nouveaux endpoints

1. Créer/modifier le contrôleur avec les décorateurs Swagger appropriés
2. Implémenter la logique métier dans le service
3. Ajouter les tests unitaires
4. Mettre à jour la documentation

### Décorateurs Swagger recommandés

```typescript
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';

@ApiTags('nom-du-module')
@Controller('route')
export class MonController {

  @Get(':id')
  @ApiOperation({ summary: 'Description courte', description: 'Description détaillée' })
  @ApiParam({ name: 'id', description: 'Description du paramètre' })
  @ApiResponse({ status: 200, description: 'Succès' })
  @ApiResponse({ status: 404, description: 'Non trouvé' })
  async maMethode(@Param('id') id: string) {
    // Logique métier
  }
}
```

## Support

Pour toute question concernant l'API, consultez la documentation Swagger interactive ou contactez l'équipe de développement.
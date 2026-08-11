# Déploiement — Service Consultation Externe (CHU)

Guide de déploiement du service **Consultation externe** sur le réseau local
du CHU. Le service est composé de **deux dépôts distincts** :

| Composant | Dépôt | Port par défaut |
|---|---|---|
| Backend (API NestJS) | `Consultation_back` | `3333` |
| Frontend (Next.js) | `Consultation_front` | `3000` |

Ce document couvre les deux, ainsi que la carte des intégrations — le service
consomme 7 services du CHU et est consommé par 2 autres.

---

## 1. Carte des intégrations

À lire **avant** de planifier le déploiement : le service ne fonctionne pas
isolément.

### 1.1 Ce que nous consommons (appels sortants)

Chaque ligne correspond à une variable d'environnement du backend. Si le
service distant est injoignable, la fonctionnalité listée se dégrade.

| Variable | Service appelé | Routes utilisées | Conséquence si indisponible |
|---|---|---|---|
| `AUTH_USER_SERVICE_URL` | Authentification (utilisateurs) | `GET /users/{id}`, `GET /users?serviceId=…` | Connexion impossible si `JWT_SECRET` ne permet pas la validation locale ; liste des médecins vide |
| `AUTH_SERVICE_URL` | Authentification (rôles) | `GET /roles` | Rôles non résolus sur la liste des médecins |
| `ACCUEIL_BASE_URL` | Accueil | `GET /accueil/patients?chuId=…` | **Tous les patients affichés « Patient introuvable »** |
| `CHU_SERVICE_BASE_URL` | CHU / prises en charge | `GET /prise-en-charge` | Informations d'assurance/prise en charge absentes |
| `CLINIQUE_BASE_URL` | Clinique | `POST /clinique/demandes`, `POST /clinique/hospitalisations` | Envoi d'une demande d'hospitalisation en échec |
| `NOTIFICATION_URL` | Notifications | `POST /notifications/service` | Pas de notification temps réel (non bloquant) |
| `SERVICE_SERVICE_BASE_URL` | Registre des services | `GET /services?chuId=…` | Liste des services cliniques vide (hospitalisation) |

> **Important** : les appels vers l'accueil et le service CHU ont un délai
> d'expiration de **8 secondes**. Si ces services sont hébergés dans le cloud
> avec démarrage à froid (mesuré jusqu'à 43 s sur Render), l'enrichissement
> patient échoue silencieusement. En réseau local (réponse < 1 s), aucun
> problème. **Déployer ces services sur le même réseau que nous est fortement
> recommandé.**

### 1.2 Ce que les autres consomment chez nous (appels entrants)

Routes exposées **sans authentification par JWT médecin**, destinées aux autres
services. Elles sont documentées dans le Swagger « services externes »
(voir §5).

| Route | Appelé par | Authentification |
|---|---|---|
| `GET /consultations/accueil/rendez-vous` | Accueil | `Bearer SERVICE_API_TOKEN` — *voir note de migration ci-dessous* |
| `POST /consultations` | Accueil | Aucune |
| `POST /consultations/{id}/arrival` | Accueil | Aucune |
| `POST /consultations/{id}/report` | Accueil | Aucune |
| `GET /consultations/accueil/requests` | Accueil | Aucune |
| `POST /consultations/accueil/requests/{id}/reponse` | Accueil | Aucune |
| `POST /consultations/externe/controle` | Service clinique | Aucune |
| `GET /consultations/events` | Frontend (SSE) | Aucune |
| `GET /health` | Docker / supervision | Aucune |

> ⚠️ **Migration en cours — `GET /consultations/accueil/rendez-vous`**
> Cette route accepte désormais `Authorization: Bearer <SERVICE_API_TOKEN>`.
> L'ancien mécanisme (autorisation sur simple correspondance de `?chuId=`) est
> **encore toléré** pour ne pas interrompre le service accueil, mais il est
> **déprécié** : chaque appel sans en-tête `Authorization` écrit un
> avertissement `[DEPRECIE]` dans les logs. Prévenir l'équipe accueil pour
> qu'elle migre, puis retirer le repli (`legacyChuIdMatches` dans
> `src/consultations/consultations.controller.ts`).

---

## 2. Prérequis

- **Docker** (et `docker compose` si vous orchestrez plusieurs conteneurs)
- **PostgreSQL** accessible depuis le conteneur backend
- Les services listés en §1.1 déployés et joignables
- Le secret de signature JWT du service d'authentification du CHU

---

## 3. Backend

### 3.1 Variables d'environnement

Toutes sont lues **au runtime** (`docker run -e` / `--env-file`), aucune n'est
à passer au build. Le service **refuse de démarrer** si l'une des 13 variables
obligatoires manque (`src/config/assert-env.ts` affiche la liste exacte).

**Règle : chaque URL ne contient que l'origine** (schéma + hôte + port), jamais
de chemin — le code ajoute les chemins lui-même.

```env
# Obligatoires
DATABASE_URL=postgresql://user:motdepasse@postgres.chu.local:5432/consultation_externe
JWT_SECRET=<secret de signature du service auth du CHU>
SERVICE_API_TOKEN=<jeton partagé serveur-à-serveur>
AUTH_SERVICE_URL=http://auth-service.chu.local
AUTH_USER_SERVICE_URL=http://auth-service.chu.local
ACCUEIL_BASE_URL=http://accueil-back.chu.local
CLINIQUE_BASE_URL=http://clinique-back.chu.local
CHU_SERVICE_BASE_URL=http://chu-service.chu.local
NOTIFICATION_URL=http://notification-back.chu.local
SERVICE_SERVICE_BASE_URL=http://service-service.chu.local
CHU_ID=<UUID du CHU>
CONSULTATION_EXTERNE_SERVICE_ID=<UUID de ce service dans le registre>
ACCUEIL_SERVICE_ID=<UUID du service accueil dans le registre>

# Optionnelles
BACKEND_PORT=3333
API_PREFIX=consultation/api
MIGRATION_ATTEMPTS=10   # tentatives de migration au démarrage
MIGRATION_DELAY=5       # secondes entre deux tentatives
```

`CHU_ID`, `CONSULTATION_EXTERNE_SERVICE_ID` et `ACCUEIL_SERVICE_ID` sont
l'**identité de ce déploiement** (« quel CHU / quel service suis-je »). Elles
ne dupliquent pas une donnée du token utilisateur : les appels serveur-à-serveur
n'ont aucun token à lire, et interroger le registre pour notre propre compte
suppose de savoir qui nous sommes. Un déploiement = un CHU.

Voir `.env.example` pour la liste complète des noms.

### 3.2 Construction et lancement

```bash
docker build -t chu-consultation-back .

docker run -d --name consultation-back \
  -p 3333:3333 \
  --env-file .env \
  --restart unless-stopped \
  chu-consultation-back
```

### 3.3 Migrations de base de données

Elles sont appliquées **automatiquement au démarrage du conteneur**
(`docker-entrypoint.sh`), pas au build — l'image reste ainsi construisible sans
accès à la base.

Sur une base vide, l'historique complet est appliqué ; sur une base existante,
seulement les migrations manquantes. En cas d'échec (base pas encore prête),
l'entrypoint réessaie 10 fois à 5 s d'intervalle, puis **démarre quand même en
mode dégradé** afin que `/health` reste interrogeable pour le diagnostic.

Pour appliquer les migrations manuellement :

```bash
docker exec consultation-back npx prisma migrate deploy
```

### 3.4 Vérification après déploiement

```bash
# 1. Le service et sa base répondent
curl http://localhost:3333/consultation/api/health
# → {"status":"ok","database":"up"}          (HTTP 200)
# → HTTP 503 si la base est injoignable

# 2. Les routes protégées refusent bien un appel anonyme
curl -o /dev/null -w '%{http_code}\n' http://localhost:3333/consultation/api/consultations
# → 401

# 3. Le token de service fonctionne
curl -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $SERVICE_API_TOKEN" \
  http://localhost:3333/consultation/api/consultations
# → 200

# 4. État du conteneur (le HEALTHCHECK doit afficher "healthy")
docker ps
```

---

## 4. Frontend

### 4.1 Particularité déterminante

Les variables `NEXT_PUBLIC_*` sont **figées dans le bundle JavaScript au moment
du build**. Elles ne sont **jamais** lues au démarrage du conteneur : les
fournir via `-e` ou `--env-file` n'a **aucun effet**. Elles doivent être
passées en `--build-arg`.

Conséquence pratique : **changer une URL impose de reconstruire l'image.**

### 4.2 Construction

```bash
docker build \
  --build-arg NEXT_PUBLIC_CONSULTATION_EXTERNE_URL=http://consultation-back.chu.local:3333 \
  --build-arg NEXT_PUBLIC_PRESCRIPTION_URL=http://prescription-back.chu.local \
  --build-arg NEXT_PUBLIC_PHARMACIE_URL=http://pharmacie-back.chu.local \
  --build-arg NEXT_PUBLIC_NOTIFICATION_URL=http://notification-back.chu.local \
  --build-arg NEXT_PUBLIC_AUTH_CLIENT_URL=http://auth-client.chu.local \
  --build-arg NEXT_PUBLIC_CONSULTATION_EXTERNE_SERVICE_ID=<UUID du service> \
  --build-arg NEXT_PUBLIC_CLINICAL_DEFAULT_SERVICE_ID=<UUID service clinique> \
  -t chu-consultation-front .

docker run -d --name consultation-front \
  -p 3000:3000 \
  -e SERVICE_API_TOKEN=<même jeton que le backend> \
  --restart unless-stopped \
  chu-consultation-front
```

Rappels :
- `NEXT_PUBLIC_CONSULTATION_EXTERNE_URL` : **origine seule**, sans
  `/consultation/api` (le code ajoute le préfixe).
- `NEXT_PUBLIC_AUTH_CLIENT_URL` : **origine seule**, sans `/login`.
- `NEXT_PUBLIC_API_URL` : concerne le backend **SIH/hospitalisation**, pas le
  nôtre — inutile pour un déploiement consultation externe seul.
- `SERVICE_API_TOKEN` est la seule variable lue au **runtime** (routes serveur
  `app/api/…`), donc fournie avec `-e`.

### 4.3 Vérification

Ouvrir `http://<hôte>:3000` : la redirection doit mener à la page de connexion
du service d'authentification. Après connexion, le fil de travail du médecin
s'affiche.

---

## 5. Documentation de l'API

Une fois le backend démarré :

| Adresse | Contenu |
|---|---|
| `http://<hôte>:3333/consultation/api/docs` | Swagger complet (toutes les routes) |
| `http://<hôte>:3333/consultation/api/externe/docs` | Swagger filtré pour les **services tiers** (accueil, clinique) |
| `http://<hôte>:3333/consultation/api/docs-json` | Schéma OpenAPI brut (JSON) |

C'est l'adresse `externe/docs` à communiquer aux équipes accueil et clinique.

---

## 6. Ordre de démarrage recommandé

1. **PostgreSQL** — doit accepter les connexions
2. **Service d'authentification** — sans lui, aucune connexion possible
3. **Registre des services**, **accueil**, **CHU/prise en charge**
4. **Backend consultation externe** — vérifier `/health` avant de continuer
5. **Frontend consultation externe**

Le backend tolère l'indisponibilité temporaire de la base (tentatives de
migration puis mode dégradé), mais un démarrage dans cet ordre évite toute
période de fonctionnement partiel.

---

## 7. Diagnostic

| Symptôme | Cause probable | Vérification |
|---|---|---|
| Conteneur `unhealthy`, `/health` → 503 | Base injoignable | `DATABASE_URL`, état de PostgreSQL, logs du conteneur |
| Tous les patients « Patient introuvable » | Accueil injoignable ou trop lent (> 8 s) | `curl $ACCUEIL_BASE_URL/accueil/patients?chuId=…` |
| Boucle de redirection vers la connexion | `NEXT_PUBLIC_AUTH_CLIENT_URL` erronée | Reconstruire le frontend avec la bonne origine |
| `401` sur toutes les routes | `JWT_SECRET` différent de celui du service auth | Comparer avec la configuration du service auth |
| Liste des médecins vide | `CONSULTATION_EXTERNE_SERVICE_ID` erroné | Comparer avec le registre service-service |
| Services cliniques absents (hospitalisation) | `SERVICE_SERVICE_BASE_URL` ou `CHU_ID` erroné | `curl $SERVICE_SERVICE_BASE_URL/services?chuId=$CHU_ID` |
| Accueil : écran rendez-vous vide | Migration `SERVICE_API_TOKEN` non faite côté accueil | Chercher `[DEPRECIE]` dans les logs backend |
| Le conteneur ne démarre pas du tout | Variable d'environnement obligatoire manquante | Les logs listent nommément les variables absentes |

Logs :

```bash
docker logs -f consultation-back
docker logs -f consultation-front
```

# Déploiement — Service Consultation Externe (CHU)

Guide de déploiement du service **Consultation externe** sur le réseau local
du CHU. Le service est composé de **deux dépôts distincts** :

| Composant | Dépôt | Port par défaut |
|---|---|---|
| Backend (API NestJS) | `Consultation_back` | `3333` |
| Frontend (Next.js) | `Consultation_front` | `3000` |

Ce document couvre les deux, ainsi que la carte des intégrations — le service
consomme les services du CHU au travers d'une passerelle unique et est
consommé par 2 autres.

---

## 1. Carte des intégrations

À lire **avant** de planifier le déploiement : le service ne fonctionne pas
isolément.

### 1.1 Ce que nous consommons (appels sortants)

Chaque ligne correspond à une variable d'environnement du backend. Si le
service distant est injoignable, la fonctionnalité listée se dégrade.

| Variable | Service appelé | Routes utilisées | Conséquence si indisponible |
|---|---|---|---|
| `GATEWAY_URL` | Passerelle unique du CHU — auth (rôles), utilisateurs, CHU/prises en charge, registre des services, accueil, clinique, notification, pharmacie, prescription | `GET /roles`, `GET /users/{id}`, `GET /prise-en-charge`, `GET /services?chuId=…`, `GET /accueil/patients?chuId=…`, `POST /clinique/demandes`, `POST /clinique/hospitalisations`, `POST /notifications/service`, `GET /articles/stock-sale-prices`, `/prescriptions/*` | Rôles non résolus, connexion impossible si `JWT_SECRET` ne permet pas la validation locale, informations d'assurance absentes, liste des services cliniques vide, **tous les patients affichés « Patient introuvable »**, envoi d'une demande d'hospitalisation en échec, pas de notification temps réel, catalogue pharmacie ou prescriptions indisponibles — selon la route touchée |

> **Une seule variable pour la quasi-totalité des services externes** : ils
> pointaient tous vers la même origine, donc une seule variable au lieu
> d'une par service — la suspension d'un service individuel sur Render
> n'oblige plus à changer une variable ici, seule la suspension de la
> passerelle elle-même nous concernerait. En déploiement réseau local, faire
> pointer `GATEWAY_URL` vers une instance de la passerelle joignable depuis
> ce réseau (Render, ou une instance de la même passerelle déployée en
> local) — voir le dépôt `gateway` (Digitheque-project/gateway). Les appels
> sans JWT médecin en scope (notifyOurService, historique notification)
> utilisent `SERVICE_API_TOKEN` à la place — **doit être configuré avec la
> même valeur côté passerelle**, sans quoi ces appels précis échouent en 401
> même si tout le reste fonctionne.
>
> **Important** : les appels vers l'accueil et le CHU (via la passerelle) ont
> un délai d'expiration de **8 secondes**. Si la passerelle ou les services
> qu'elle proxifie sont hébergés dans le cloud avec démarrage à froid (mesuré
> jusqu'à 43 s sur Render), l'enrichissement patient échoue silencieusement.
> En réseau local (réponse < 1 s), aucun problème. **Déployer la passerelle
> sur le même réseau que nous est fortement recommandé.**

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
à passer au build. Le service **refuse de démarrer** si l'une des 4 variables
obligatoires manque (`src/config/assert-env.ts` affiche la liste exacte).

**Règle : chaque URL ne contient que l'origine** (schéma + hôte + port), jamais
de chemin — le code ajoute les chemins lui-même.

```env
# Obligatoires
DATABASE_URL=postgresql://user:motdepasse@postgres.chu.local:5432/consultation_externe
JWT_SECRET=<secret de signature du service auth du CHU>
SERVICE_API_TOKEN=<jeton partagé serveur-à-serveur — doit être identique côté passerelle>
GATEWAY_URL=http://gateway.chu.local

# Optionnelles
BACKEND_PORT=3333
API_PREFIX=consultation/api
MIGRATION_ATTEMPTS=10   # tentatives de migration au démarrage
MIGRATION_DELAY=5       # secondes entre deux tentatives
CHU_ID=<UUID du CHU — override manuel, voir ci-dessous>
CONSULTATION_EXTERNE_SERVICE_ID=<UUID de ce service — override manuel>
ACCUEIL_SERVICE_ID=<UUID du service accueil — override manuel>
```

`CHU_ID`, `CONSULTATION_EXTERNE_SERVICE_ID` et `ACCUEIL_SERVICE_ID` sont
l'**identité de ce déploiement** (« quel CHU / quel service suis-je »). Elles
ne sont **plus obligatoires** : au démarrage, `resolveIdentityEnvVars()`
(`src/config/resolve-identity.ts`) les résout automatiquement via
`GET /services` sur la passerelle, en retrouvant l'entrée nommée
« Consultation externe » (→ notre id + son `chuId`) puis l'entrée « Accueil »
du même CHU. Comme pour les variables manquantes, toute ambiguïté (0 ou
plusieurs candidats) ou tout échec réseau fait échouer le démarrage
**bruyamment**, jamais un choix silencieux ou un repli périmé — ce principe
répond à un incident réel où une identité de déploiement erronée avait été
utilisée silencieusement. Les renseigner ici manuellement reste possible : si
les **trois** sont définies, la résolution automatique est court-circuitée
(utile en environnement de test/CI sans accès à la passerelle, ou pour lever
une ambiguïté que la résolution automatique a signalée). Un déploiement =
un CHU.

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
  --build-arg NEXT_PUBLIC_CONSULTATION_EXTERNE_URL=http://gateway.chu.local \
  --build-arg NEXT_PUBLIC_DOSSIER_PATIENT_API_URL=http://gateway.chu.local \
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
  `/consultation/api` (le code ajoute le préfixe) — pointe vers la passerelle
  du CHU, plus directement vers `consultation-back` (qui reste, lui, joignable
  en direct via la passerelle : entrée `Consultation` de son registre).
- `NEXT_PUBLIC_DOSSIER_PATIENT_API_URL` : idem, origine de la passerelle.
- `NEXT_PUBLIC_AUTH_CLIENT_URL` : **origine seule**, sans `/login` — ce n'est
  pas une API du CHU (site de connexion SSO), reste hors passerelle.
- `NEXT_PUBLIC_PRESCRIPTION_URL`, `NEXT_PUBLIC_PHARMACIE_URL`,
  `NEXT_PUBLIC_NOTIFICATION_URL` : **supprimées** — ces trois services sont
  désormais relayés par `consultation-back` (voir §1.1), le navigateur ne
  les appelle plus jamais directement.
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
2. **Passerelle du CHU** (`GATEWAY_URL`) — sans elle, aucune connexion ni
   aucun service externe (auth, accueil, CHU/prise en charge, clinique,
   notification, pharmacie, prescription) n'est joignable
3. **Backend consultation externe** — vérifier `/health` avant de continuer
4. **Frontend consultation externe**

Le backend tolère l'indisponibilité temporaire de la base (tentatives de
migration puis mode dégradé), mais un démarrage dans cet ordre évite toute
période de fonctionnement partiel.

---

## 7. Diagnostic

| Symptôme | Cause probable | Vérification |
|---|---|---|
| Conteneur `unhealthy`, `/health` → 503 | Base injoignable | `DATABASE_URL`, état de PostgreSQL, logs du conteneur |
| Tous les patients « Patient introuvable » | Passerelle (`GATEWAY_URL`) ou accueil injoignable, ou trop lent (> 8 s) | `curl -H "Authorization: Bearer <JWT>" $GATEWAY_URL/accueil/patients?chuId=…` |
| Boucle de redirection vers la connexion | `NEXT_PUBLIC_AUTH_CLIENT_URL` erronée | Reconstruire le frontend avec la bonne origine |
| `401` sur toutes les routes | `JWT_SECRET` différent de celui du service auth | Comparer avec la configuration du service auth |
| Liste des médecins vide | Résolution de `CONSULTATION_EXTERNE_SERVICE_ID` en échec/ambiguë au démarrage | Chercher `🔎 Identité résolue` ou `❌ ... résolution de l'identité` dans les logs au démarrage |
| Services cliniques absents (hospitalisation) | `GATEWAY_URL` injoignable, ou résolution de `CHU_ID` en échec/ambiguë | `curl -H "Authorization: Bearer <JWT>" $GATEWAY_URL/services?chuId=$CHU_ID` ; vérifier aussi les logs de démarrage |
| Accueil : écran rendez-vous vide | Migration `SERVICE_API_TOKEN` non faite côté accueil | Chercher `[DEPRECIE]` dans les logs backend |
| Le conteneur ne démarre pas du tout | Variable d'environnement obligatoire manquante | Les logs listent nommément les variables absentes |

Logs :

```bash
docker logs -f consultation-back
docker logs -f consultation-front
```

# Rapid Services 2.0

Application web multilingue (français, English, Kiswahili) pour restaurants, hôtels et centres de services.

## Fonctionnalités de cette version
- Inscription et connexion par établissement.
- Espace privé par entreprise : les requêtes de données sont limitées à l'identifiant de l'établissement du compte connecté.
- Mot de passe haché avec bcryptjs et session JWT (7 jours).
- Base PostgreSQL : commandes, réservations/rendez-vous, clients et catalogue.
- Actions WhatsApp ouvrant une conversation wa.me (aucun message automatique n'est envoyé).
- Interface responsive et sélecteur de langue.

## Déploiement sur Render
1. Créer une base **Render PostgreSQL**.
2. Déployer ce dossier comme service **Web Service Node**.
3. Build command : `npm install`
4. Start command : `npm start`
5. Ajouter les variables d'environnement :
   - `DATABASE_URL` : Internal Database URL de la base PostgreSQL Render.
   - `JWT_SECRET` : une chaîne aléatoire longue et privée (au moins 32 caractères).
   - `NODE_ENV=production`
6. Après le déploiement, ouvrir `/api/health`. La réponse doit indiquer `"database":true`.

La base et les tables sont initialisées automatiquement au démarrage.

## Test local
Node.js 18+ et PostgreSQL requis.

```bash
npm install
DATABASE_URL=postgres://... JWT_SECRET='une-cle-longue-et-secrete' npm start
```

Ouvrir `http://localhost:3000`.

## Limites connues / avant commercialisation
- L'intégration WhatsApp Cloud API n'est pas encore branchée : les liens ouvrent seulement une conversation.
- Pas encore de rôles employés, invitations d'équipe, réinitialisation de mot de passe, sauvegardes automatisées, facturation ou vérification d'e-mail.
- Prévoir HTTPS (Render le fournit), sauvegardes PostgreSQL, politique de confidentialité, conditions d'utilisation et tests de sécurité avant de vendre ou traiter des données réelles.
- Les données des établissements sont séparées côté API par `business_id`; faire réaliser un audit de sécurité avant un lancement commercial.

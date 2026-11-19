# Rapid Services 3.5.16 — droits opérationnels et traçabilité

## Droits employés
- Les employés peuvent lire, créer, modifier et traiter les commandes, réservations et fiches clients de leur établissement.
- Le catalogue reste réservé au gérant : lecture, création, modification et suppression sont contrôlées côté serveur.
- Les opérations restent isolées par `business_id`.
- Les protections existantes des factures payées/terminées et des champs financiers sont conservées.

## Traçabilité
- À la création, le serveur inscrit `_createdBy` avec l'identité issue de la session authentifiée.
- À la modification, le serveur préserve `_createdBy` et met à jour `_updatedBy`.
- L'interface affiche l'auteur de la création et, si différent, le dernier éditeur.
- Les champs d'identité d'audit envoyés par le navigateur ne sont pas considérés comme fiables.

## Vérifications effectuées
- `node --check server.js`
- Vérification syntaxique du JavaScript intégré à `public/index.html`

## À tester avant production
- Connexion réelle avec un compte gérant et un compte employé.
- Création et traitement d'une commande, réservation et fiche client par l'employé.
- Tentatives directes d'accès employé aux quatre méthodes API du catalogue (doivent renvoyer HTTP 403).
- Vérification de l'affichage des noms d'auteurs sur les enregistrements historiques et nouveaux.
- Tests d'intégration avec PostgreSQL/Render non effectués ici.

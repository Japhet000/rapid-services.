# Rapid Services 3.5.5 — correction de l'accès aux routes

## Correction de sécurité

Dans les versions précédentes, les routes `/api/team`, `/api/location` et `/api/settings` étaient déclarées avant les appels `app.use()` qui devaient appliquer le contrôle d'abonnement. Dans Express, un middleware déclaré après une route ne protège pas rétroactivement cette route.

La version 3.5.5 applique donc explicitement `subscriptionRequired` dans chaque route concernée :
- consultation, création et suppression des comptes employés ;
- partage et arrêt du partage GPS ;
- lecture et enregistrement du profil/branding.

Les vérifications `auth` et `ownerOnly` restent en place. Le contrôle d'abonnement est aussi appliqué aux routes `/api/records` et `/api/reports` par les middlewares existants placés avant leurs routes.

## Vérification effectuée

- `node --check server.js` : réussi.
- Version `package.json` et `/api/health` : 3.5.5.

## Limites restantes — ne pas considérer comme livraison finale

Cette archive n'a pas été testée contre la base PostgreSQL de production ni sur Render. Les permissions granulaires par rôle, les statuts employés modifiables, l'audit trail des corrections/suppressions de factures, les tests GPS réels et les tests complets de rapports restent à finaliser. Ne pas déployer sans sauvegarde préalable de la base et validation sur un environnement de test.

Aucune commande de suppression ou de réinitialisation des données PostgreSQL n'est ajoutée dans cette version.

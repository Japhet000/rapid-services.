# Rapid Services 3.2 — Abonnements et paiements manuels

Cette version ajoute un espace Abonnement & paiements, l'historique des demandes, et un tableau d'administration privé pour vérifier manuellement les transactions. Les tables sont créées avec CREATE TABLE IF NOT EXISTS : les données existantes ne sont pas supprimées.

## Tarifs
- Basic : 10 USD / mois ou 60 000 BIF
- Professional : 15 USD / mois ou 90 000 BIF
- Business : 20 USD / mois ou 120 000 BIF

## Moyens de paiement configurés
- Lumicash : 69637418 — UWITONZE JAPHET
- BANCOBU eNoti : code agent 49094 — UWITONZE JAPHET
- USDT BEP20 : 0x5faaaf9ee6e8085489e63077a8382e77908af720

Les paiements sont déclarés par l'utilisateur avec leur référence ou TXID puis vérifiés manuellement par le fondateur. Il n'y a pas de connexion API officielle Lumicash/eNoti ni de vérification blockchain automatique dans cette version. Ne marquez un paiement USDT comme approuvé qu'après vérification du TXID sur un explorateur BNB Smart Chain et confirmation de la réception du montant.

## Déploiement Render
1. Build command : `npm install`
2. Start command : `npm start`
3. Conserver `DATABASE_URL` et `JWT_SECRET` existants.
4. Ajouter une variable Render `ADMIN_SECRET` contenant un secret long et aléatoire (au moins 32 caractères). Ne mettez pas ce secret dans GitHub ni dans le code.
5. Déployer.

## Administration
Ouvrir `https://VOTRE-DOMAINE/admin.html`, entrer le même `ADMIN_SECRET`, puis approuver/refuser les paiements. L'approbation active ou prolonge l'abonnement de 30 jours. Le code secret est gardé uniquement dans sessionStorage du navigateur d'administration.

## Important
- Les fonctionnalités actuelles de l'application ne sont pas bloquées selon le statut d'abonnement dans cette version afin de préserver l'accès des comptes existants. Le statut et la validation des abonnements sont enregistrés ; la mise en place d'un blocage à l'expiration doit être décidée séparément.
- Les montants sont fixes côté serveur et ne sont pas acceptés depuis le navigateur.
- Aucune donnée métier ni aucun compte existant n'est supprimé.

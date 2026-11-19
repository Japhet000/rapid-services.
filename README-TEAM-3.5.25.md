# Rapid Services 3.5.25 — Activité complète de l’équipe

- Journalise les créations, modifications et suppressions des commandes, réservations et clients.
- Enregistre l’entreprise, le type d’enregistrement, l’utilisateur authentifié, le rôle, l’action et les données avant/après.
- La consultation de l’activité reste réservée au gérant et limitée à son entreprise.
- L’historique individuel des factures reste filtré sur les commandes (`record_kind='orders'`).
- Migration additive : ajout de `record_kind` avec valeur par défaut `orders`; aucune suppression/réinitialisation de données.

Vérifications locales uniquement. Tester sur Render/PostgreSQL avant mise en production.

# Rapid Services 3.5.24 — Activité de l’équipe

- Ajoute une route propriétaire `GET /api/team/activity`, protégée par authentification, rôle propriétaire et abonnement actif.
- La route lit les 50 événements les plus récents de `invoice_audit_log`, limités au `business_id` de la session.
- Ajoute au tableau de bord du gérant un panneau « Activité de l’équipe » avec actualisation manuelle.
- Affiche l’auteur, l’action, le client ou le détail de la commande, le statut et la date.
- Réutilise l’historique existant : aucune nouvelle table, migration destructive ou suppression de données.
- La fonctionnalité couvre les commandes/factures déjà journalisées. Elle ne prétend pas journaliser les réservations ou clients.

Vérifications locales : `node --check server.js`, JSON package et intégrité ZIP. Pas de test Render/PostgreSQL effectué.

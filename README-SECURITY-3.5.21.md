# Rapid Services 3.5.21 — validation financière et historique

- Le serveur annonce maintenant la version 3.5.21 sur `/api/health`.
- Les créations et modifications de commandes par le gérant rejettent les montants négatifs ou non numériques.
- Le montant payé ne peut pas dépasser le montant total lorsqu'un total est renseigné.
- L'historique d'une facture valide l'identifiant et vérifie que la commande appartient bien à l'entreprise connectée avant de retourner les événements.
- Les événements d'audit existants et les données PostgreSQL ne sont pas supprimés ni réinitialisés.

Vérifications locales : syntaxe JavaScript, JSON de package et intégrité de l'archive. Aucun test Render ou PostgreSQL de production n'a été effectué.

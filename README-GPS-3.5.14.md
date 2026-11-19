# Rapid Services 3.5.14 — Fiabilisation du partage GPS

- Le partage reste volontaire : l’employé doit cliquer sur le bouton et autoriser la géolocalisation du navigateur.
- Les coordonnées et la précision sont validées côté serveur.
- La précision GPS doit être comprise entre 0 et 10 000 mètres.
- Les écritures de position sont limitées à une mise à jour toutes les 15 secondes par employé afin d’éviter les écritures excessives déclenchées par `watchPosition`.
- Le gérant continue à voir la dernière position et son horodatage dans la rubrique Équipe.
- L’arrêt du partage supprime la dernière position enregistrée.

Aucun schéma PostgreSQL n’est modifié. Cette version doit être testée sur une base de préproduction avant déploiement. Le navigateur ne garantit pas le suivi GPS en arrière-plan.

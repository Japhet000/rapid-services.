# Rapid Services 3.5.26 — Notifications de l’équipe

- Ajout d’une table `team_notifications`, créée automatiquement au démarrage sans supprimer les données existantes.
- Le gérant reçoit une notification enregistrée lorsqu’un employé crée une commande ou une réservation.
- Le gérant reçoit une notification lorsqu’un employé fait passer une commande à l’état terminé.
- Les notifications sont isolées par `business_id`, accessibles uniquement au gérant, et peuvent être marquées comme lues.
- Le tableau de bord actualise le compteur toutes les 30 secondes lorsque le gérant est connecté.
- Les notifications sont internes à l’application : aucune notification push ou SMS lorsque l’application est fermée n’est envoyée.

Vérifications locales : `node --check server.js`, analyse du JavaScript intégré à `public/index.html`, validation JSON et intégrité ZIP. Aucun test Render/PostgreSQL de production n’a été exécuté.

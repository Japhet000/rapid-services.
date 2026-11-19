# Rapid Services 3.5.2 – changements de sécurité préparatoires

## Changements
- Sessions serveur persistantes dans `auth_sessions`, avec identifiant de session JWT (`sid`).
- Endpoint `POST /api/auth/logout` qui révoque la session côté PostgreSQL.
- Validation de session côté serveur à chaque requête authentifiée.
- Contrôle d'abonnement sur les routes opérationnelles (données, équipe, GPS, paramètres et rapports), tout en laissant accessibles les routes de connexion et d'abonnement/paiement.
- Délai initial de 30 minutes après création du compte avant le blocage pour absence d'abonnement.
- Déconnexion de l'interface appelant maintenant le endpoint serveur.
- Rapport courant et archivage alignés sur une journée commerciale de 03:00 à 02:59, fuseau Africa/Bujumbura.

## Important avant déploiement
- `DATABASE_URL` et `JWT_SECRET` doivent être définis dans Render.
- Le serveur crée la table `auth_sessions` avec `CREATE TABLE IF NOT EXISTS` au démarrage. Aucune table métier existante n'est supprimée.
- Cette version n'est pas encore la livraison finale complète : les notifications visuelles automatiques (30 min et J-3), le verrouillage global avec écran de renouvellement, la gestion complète des rôles/statuts employés, la page historique/impression, et les tests de bout en bout sur une vraie base PostgreSQL doivent encore être terminés.
- Ne pas remplacer la production avant sauvegarde PostgreSQL et validation sur un service Render de préproduction.


## Version 3.5.3 — rappels d’abonnement
- Ajout de l’endpoint propriétaire `/api/subscription/status` pour exposer le délai depuis la création du compte et la date d’expiration.
- Rappel après 30 minutes sans abonnement, avertissement quotidien dans les 3 jours avant expiration et écran persistant à expiration.
- La période de grâce de 30 minutes est désormais calculée depuis la création du compte gérant, et non depuis celle d’un compte employé.
- Ces rappels nécessitent que l’application soit ouverte dans un navigateur pour afficher la notification. Le contrôle d’accès reste côté serveur sur les routes opérationnelles.

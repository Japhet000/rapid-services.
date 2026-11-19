# Rapid Services 3.5.11 — reprise d'archivage quotidien

Cette version complète la programmation des rapports journaliers :
- Au démarrage du serveur, si l'heure locale Africa/Bujumbura est au moins 03:00, le serveur tente d'archiver la dernière journée commerciale clôturée.
- L'archivage reste idempotent grâce à la contrainte unique (business_id, report_date) et `ON CONFLICT DO NOTHING`.
- Le planificateur quotidien à 03:00 reste actif.
- Le point `/api/health` annonce maintenant la version 3.5.11.

Aucune table métier n'est supprimée et aucune commande existante n'est modifiée par cette correction.

À vérifier impérativement sur un environnement de test avec PostgreSQL avant production : résultat des requêtes SQL, fuseau horaire du service, rapport imprimé et reprise après redémarrage. Cette archive n'a pas été testée sur la base Render du propriétaire.

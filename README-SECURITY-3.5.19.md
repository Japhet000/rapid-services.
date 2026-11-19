# Rapid Services 3.5.19 — protection du statut payé

- Renforce le contrôle serveur : un employé ne peut pas transformer une commande en statut « payé » via le champ opérationnel `status`.
- Les statuts payé en français et en anglais sont reconnus pour le verrouillage côté interface.
- Les employés peuvent toujours marquer une commande comme terminée (`Terminé` / `completed`), conformément au fonctionnement demandé.
- Le gérant conserve la gestion des paiements.
- Version de l'endpoint `/api/health` alignée sur 3.5.19.

Vérifications effectuées : syntaxe JavaScript du serveur, JSON du package et intégrité de l'archive. Aucun test sur Render ou sur la base PostgreSQL de production n'a été effectué.

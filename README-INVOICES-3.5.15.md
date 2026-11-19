# Rapid Services 3.5.15 — Audit complet des commandes et factures

Cette version reprend le projet 3.5.14 et apporte deux corrections ciblées :

- Chaque modification d'une commande/facture est désormais inscrite dans `invoice_audit_log`, y compris les modifications d'une commande encore impayée effectuées par un employé.
- L'interface considère aussi une facture partiellement payée (`paidAmount > 0`) comme verrouillée pour les employés, en cohérence avec le contrôle serveur.
- La version renvoyée par `/api/health` est alignée sur `3.5.15`.

Aucune table métier n'est supprimée et aucune migration destructive n'est ajoutée. L'initialisation existante crée déjà `invoice_audit_log`.

## Limites de validation

Les contrôles de syntaxe et l'intégrité de l'archive peuvent être vérifiés localement. Les scénarios d'autorisation doivent encore être testés avec une base PostgreSQL de test et deux comptes distincts (gérant/employé) avant déploiement.

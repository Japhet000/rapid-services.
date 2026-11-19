# Rapid Services 3.5.7 — Historique d'audit des factures

Cette version ajoute une piste d'audit serveur pour les éléments `orders` (commandes/factures).

## Fonctionnement
- Chaque création d'une commande/facture écrit une entrée `created` dans `invoice_audit_log`.
- Chaque modification d'une commande/facture écrit une entrée `updated` si elle concerne une facture déjà payée/terminée, devient payée/terminée, ou est effectuée par le gérant.
- La suppression d'une facture payée/terminée par le gérant écrit une entrée `deleted` avant la suppression.
- L'historique est accessible au gérant via `GET /api/invoices/:id/history`.
- Les écritures d'audit et l'opération métier correspondante sont effectuées dans la même transaction PostgreSQL.

## Migration
Au démarrage, `initDb()` crée `invoice_audit_log` et son index avec `CREATE TABLE IF NOT EXISTS`. Aucune table métier existante n'est supprimée ni réinitialisée.

## Limites à connaître
- L'API garde la suppression possible au gérant, mais l'action est tracée. Pour une comptabilité stricte, il est préférable de remplacer ultérieurement la suppression par une annulation/avoir non destructive.
- L'interface n'affiche pas encore un bouton « Historique » sur chaque facture ; l'API est prête, son intégration visuelle reste à faire.
- Tests syntaxiques uniquement : aucune connexion à la base PostgreSQL de production ni test Render n'a été exécuté.

# Rapid Services 3.5.30 — Sessions et connexions

- Enregistre l'adresse IP et le user-agent lors de la création d'une session.
- Ajoute `last_login_at` sur les utilisateurs et affiche la dernière connexion dans la liste du personnel.
- Ajoute un endpoint propriétaire pour consulter les 20 dernières sessions d'un employé.
- Ajoute un endpoint propriétaire pour révoquer toutes les sessions d'un employé ; sa dernière position partagée est alors supprimée.
- Les routes vérifient le rôle propriétaire, l'identifiant employé, et le `business_id` afin d'empêcher l'accès inter-entreprises.
- Migration additive via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; aucune suppression de données ni réinitialisation de PostgreSQL.

Les nouvelles colonnes sont ajoutées au démarrage par `initDb`. Les essais d'intégration Render/PostgreSQL doivent encore être réalisés.

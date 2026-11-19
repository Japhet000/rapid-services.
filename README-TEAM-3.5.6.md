# Rapid Services 3.5.6 — gestion d’équipe

Cette version ajoute la gestion des statuts et la désactivation réversible des comptes employés.

## Modifications
- Ajout des colonnes `users.is_active` et `users.staff_status` par migrations `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` non destructives.
- Statuts disponibles : `en_service`, `en_pause`, `hors_service`.
- Le gérant peut modifier le statut et réactiver un compte désactivé.
- La désactivation conserve l’utilisateur, ses enregistrements et son historique ; elle révoque les sessions ouvertes.
- La connexion refuse les comptes désactivés et le middleware vérifie aussi que le compte est actif.

## Déploiement
Sauvegarder la base PostgreSQL avant déploiement. La migration s’exécute au démarrage et ne supprime aucune table ni aucun enregistrement.

## Limites
Les rôles détaillés personnalisables, l’édition de l’adresse e-mail et le journal d’audit des actions du gérant ne sont pas inclus dans cette livraison. Le GPS reste volontaire et fonctionne lorsque l’application est ouverte selon les capacités du navigateur.

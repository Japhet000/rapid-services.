# Rapid Services 3.5.13 — Protection des chiffres d’affaires

## Modification
Les comptes employés ne reçoivent plus les champs financiers des commandes via l’API de lecture. Lorsqu’un employé crée ou modifie une commande, les champs `amount`, `paidAmount`, `paymentStatus` et `paymentMethod` sont supprimés ou conservés depuis la base, sans accepter les valeurs envoyées par l’employé.

## Portée et limites
- Les comptes gérant conservent l’accès aux données financières.
- Les employés peuvent toujours consulter et gérer les autres informations des commandes selon les routes déjà existantes.
- Aucun changement de schéma PostgreSQL n’est requis pour cette correction.
- Cette archive n’a pas été testée contre la base PostgreSQL de production ni sur Render. Effectuer les tests de staging avant tout déploiement.

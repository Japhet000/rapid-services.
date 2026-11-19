# Rapid Services 3.5.17 — finalisation d'une commande par un employé

## Correction
- Un employé peut désormais faire passer une commande à l'état « terminé » pour indiquer que le travail opérationnel est achevé.
- Une commande déjà terminée, payée ou ayant un montant payé reste verrouillée pour l'employé.
- L'enregistrement d'un paiement et l'augmentation du montant payé restent réservés au gérant.
- La modification conserve les champs financiers stockés et ajoute une entrée d'audit.

## Vérifications locales
- `node --check server.js`
- validation JSON de `package.json`
- Le comportement PostgreSQL/Render doit être testé dans un environnement de test avant production.

# Rapid Services 3.5.20 — correction des revenus

- Les rapports de revenus ne comptent plus une commande simplement marquée « terminée » si aucun paiement n’a été enregistré.
- Un paiement partiel est comptabilisé à hauteur de `paidAmount`.
- Une commande marquée « payé » utilise `paidAmount` si renseigné, sinon `amount`.
- La règle est appliquée au rapport du jour et aux instantanés quotidiens.
- Les rapports restent basés sur la date de création de la commande (`records.created_at`), et non sur une date distincte de réception du paiement, car le modèle actuel ne stocke pas cette date.

Vérifications locales : syntaxe JavaScript, JSON du package et intégrité de l’archive. Aucun test Render/PostgreSQL de production n’a été exécuté.

# Rapid Services 3.5.23 — Protection de l’historique des factures

- Une commande terminée ou comportant un paiement ne peut plus être supprimée, même par le gérant.
- La règle est appliquée côté serveur pour éviter un contournement depuis le navigateur.
- Le bouton de suppression est masqué dans l’interface pour les factures verrouillées.
- Les factures protégées restent présentes dans la base et leur historique d’audit reste consultable.
- Le point de santé `/api/health` annonce maintenant la version 3.5.23.

Aucune table ni donnée existante n’est supprimée ou réinitialisée. Vérifications locales uniquement ; les tests Render/PostgreSQL de production restent à effectuer.

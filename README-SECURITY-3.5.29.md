# Rapid Services 3.5.29 — Sécurité des connexions

- Ajout d’un historique PostgreSQL des tentatives de connexion.
- Limite à 8 échecs par couple adresse e-mail / adresse IP sur une fenêtre de 15 minutes.
- Réponse HTTP 429 et en-tête Retry-After après dépassement.
- Les tentatives réussies sont également consignées.
- Version affichée par /api/health et journal de démarrage alignés sur APP_VERSION.

La limitation repose sur PostgreSQL et s’applique donc après redémarrage. Elle ne remplace pas un pare-feu/WAF et le test de production doit être effectué après déploiement. Aucune table métier ni donnée existante n’est supprimée.

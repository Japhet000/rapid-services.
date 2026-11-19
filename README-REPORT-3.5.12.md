# Rapid Services 3.5.12 — fiabilisation des rapports

- Le rapport du jour et les archives utilisent désormais exactement la même règle de journée commerciale : 03:00 à 02:59, fuseau `Africa/Bujumbura`.
- Le nombre de commandes du rapport ne compte que les commandes payées ou terminées, comme le chiffre d'affaires.
- Après un redémarrage, l'archivage rattrape toutes les journées clôturées manquantes depuis la dernière archive connue, sans dupliquer les dates déjà archivées.
- Si aucune archive n'existe encore, seule la dernière journée clôturée est initialisée ; le système ne fabrique pas de rapports historiques plus anciens.
- Les archives restent idempotentes grâce à la contrainte unique `(business_id, report_date)`.

## Vérifications locales

- `node --check server.js` : réussi.
- Vérification de syntaxe du JavaScript embarqué dans `public/index.html` : voir validation de livraison.
- PostgreSQL réel et Render : non testés dans cet environnement. Ne pas déployer sans sauvegarde et test de migration.

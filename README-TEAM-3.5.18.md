# Rapid Services 3.5.18 — accès employés et suppressions

Correctifs ciblés :
- Le chargement des données d'un compte employé ne demande plus le catalogue réservé au gérant. Les commandes, réservations et clients peuvent donc être chargés sans échouer sur le catalogue.
- Les employés ne voient plus les champs financiers des commandes dans le formulaire. Les montants et informations de paiement restent réservés au gérant et protégés côté serveur.
- Les employés peuvent continuer à créer et modifier les commandes non verrouillées, réservations et clients. La commande peut être marquée terminée ; après cela, elle est verrouillée pour l'employé.
- La suppression de tout enregistrement est désormais réservée au gérant, côté interface et côté serveur.
- Les données restent filtrées par entreprise. Aucune migration ou suppression de base de données n'est incluse.

Vérifications effectuées : syntaxe Node.js du serveur, syntaxe du JavaScript intégré à la page et intégrité de l'archive ZIP. Aucun test réel sur Render ou sur la base PostgreSQL de production n'a été effectué.

# Rapid Services 3.5.31 — Sécurité des mots de passe et activité

Cette version ajoute :
- Changement du mot de passe du compte connecté après vérification de l’ancien mot de passe.
- Révocation des autres sessions après changement du mot de passe. La session courante reste active.
- Réinitialisation du mot de passe d’un employé par le gérant, uniquement pour un employé de sa propre entreprise.
- Révocation de toutes les sessions de l’employé et suppression de sa dernière position partagée après réinitialisation.
- Mise à jour de la dernière activité d’une session au plus une fois toutes les cinq minutes.
- Mots de passe hashés avec bcrypt ; aucun mot de passe n’est renvoyé par l’API.

Les changements SQL sont additifs et ne suppriment pas les données existantes. Aucune suppression ou réinitialisation de la base PostgreSQL n’est requise.

Vérifications effectuées : syntaxe Node.js du serveur, syntaxe du JavaScript intégré à la page, validité JSON de package.json et intégrité de l’archive ZIP. Aucun test d’intégration avec la base PostgreSQL ou Render n’a été effectué dans cet environnement.

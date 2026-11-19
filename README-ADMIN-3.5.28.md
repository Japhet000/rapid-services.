# Rapid Services 3.5.28 — protection des validations administrateur

- La validation reste atomique côté PostgreSQL : le paiement est verrouillé avec `FOR UPDATE` et une demande déjà traitée renvoie HTTP 409. Deux validations concurrentes ne peuvent donc pas activer deux fois le même paiement.
- L'identifiant de paiement est validé avant la requête SQL.
- Le champ note doit être une chaîne et reste limité à 500 caractères.
- L'interface affiche la durée exacte du forfait choisi au lieu d'annoncer systématiquement 30 jours.
- Un motif est demandé lors d'un refus et les boutons sont temporairement désactivés pendant le traitement.
- Aucun changement destructif ni réinitialisation de PostgreSQL.

Vérifications locales uniquement. Aucun test de connexion à Render ou PostgreSQL de production n'a été effectué.

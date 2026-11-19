# Rapid Services 3.5.22 — confidentialité GPS

- Le partage GPS reste volontaire et déclenché par l'employé depuis le bouton de partage.
- La déconnexion supprime désormais la dernière position enregistrée côté serveur.
- La désactivation du compte employé (par modification ou désactivation) révoque ses sessions et supprime sa position enregistrée.
- L'écran Équipe indique explicitement qu'une position ancienne n'est pas une position en direct et affiche la précision GPS lorsqu'elle est disponible.
- Aucune géolocalisation en arrière-plan ni collecte cachée n'est ajoutée.

Vérifications locales : syntaxe Node.js et intégrité ZIP. Aucun test de production Render/PostgreSQL n'a été exécuté.

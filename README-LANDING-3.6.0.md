# Landing page (3.6.0)

- `/` : page d'accueil commerciale (`public/index.html`)
- `/app` : l'application (connexion, tableau de bord) (`public/app.html`)
- Langues : FR / EN / SW (sélecteur en haut de la page, texte dans le script en bas de `public/index.html`). À faire relire en kiswahili par un locuteur natif.
- Les boutons « Connexion » et « Créer mon compte » de la page d'accueil pointent vers `/app`.
- Pour modifier la page d'accueil, éditez `public/index.html`.
- Ajouts (3.6.1) : section « Comment ça marche », FAQ (6 questions, 3 langues), bouton WhatsApp flottant, icône du site, balises de partage (Open Graph), `public/robots.txt`.
- Ajouts (3.7.0) :
  - Essai gratuit : 7 jours par défaut (variable Render `TRIAL_DAYS` pour changer). Le texte de la page d'accueil et des conditions dit « 7 jours » : modifiez-le si vous changez la durée.
  - Mot de passe oublié : le client demande un code sur WhatsApp ; vous le générez dans `/admin.html` (« Mot de passe oublié ») ; il est valable 60 min et à usage unique.
  - Limite de création de comptes : 5 par heure et par connexion.
  - Pages `/conditions.html` et `/confidentialite.html` (modèles à faire relire par un juriste).
  - Témoignages et captures : listes `AVIS` et `SHOTS` en bas de `public/index.html` (sections cachées tant qu'elles sont vides).

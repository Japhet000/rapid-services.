Rapid Services 3.0
Application multilingue (français, anglais, swahili) pour restaurants, hôtels et centres de services.
Fonctionnalités incluses
Comptes propriétaires, connexion et séparation des données par établissement.
Tableau de bord et gestion des commandes, réservations/rendez-vous, clients et catalogue.
Suivi des montants, paiements et soldes; rapport CSV et impression.
Factures imprimables / enregistrables en PDF depuis le navigateur.
Personnalisation de l'établissement : nom, coordonnées, adresse, logo et couleurs.
Paramètres de marque enregistrés dans PostgreSQL par établissement.
Liens WhatsApp avec texte préparé; aucun envoi automatique n'est activé.
Interface responsive pour téléphone et ordinateur.
Déploiement sur Render
Build command: npm install
Start command: npm start
Conserver les variables existantes DATABASE_URL et JWT_SECRET.
Définir NODE_ENV=production.
Ne pas supprimer la base PostgreSQL existante. Les nouvelles tables sont créées automatiquement.
Important
L'envoi automatique WhatsApp est volontairement laissé désactivé pour le moment.
Les factures PDF sont générées par la fonction Imprimer / Enregistrer en PDF du navigateur.
Cette version ne comprend pas encore la gestion avancée des comptes employés, invitations et permissions détaillées.
Avant une commercialisation, prévoir tests complets, sauvegardes, politique de confidentialité, conditions d'utilisation et audit de sécurité.

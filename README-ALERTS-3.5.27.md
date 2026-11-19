# Rapid Services 3.5.27

## Alertes de paiement et d'abonnement
- Lorsqu'une demande de paiement d'abonnement est approuvée ou refusée par l'administration, une notification est créée pour le propriétaire de l'entreprise concernée.
- La notification indique la décision, la formule et, en cas de refus, la note administrative fournie.
- Les notifications de décision sont stockées dans la table existante `team_notifications`; aucune table ni migration destructive n'est ajoutée.
- Les propriétaires peuvent consulter et marquer ces alertes comme lues même lorsque l'abonnement est expiré, afin de pouvoir voir un refus et corriger leur demande.
- Les notifications restent isolées par `business_id`.

## Limites
- Les alertes sont visibles dans l'application et récupérées par interrogation périodique lorsque le gérant est connecté. Aucun SMS, e-mail ou push hors application n'est envoyé.
- La validation des paiements reste manuelle par l'administration.

# GE Appliances (SmartHQ)

## Présentation

Cette intégration amène dans Gladys l'électroménager connecté de **GE Appliances**, par le cloud
**SmartHQ** : GE, GE Profile, Café, Monogram, Haier (États-Unis) et Hotpoint. Lave-linge, sèche-linge et
lave-vaisselle donnent leur état, leur programme et le temps restant ; fours et cuisinières leur
température et leurs minuteries ; réfrigérateurs leurs températures, consignes, portes et filtre à eau ;
les climatiseurs de fenêtre et mobiles se pilotent comme tout climatiseur de Gladys.

Les changements arrivent en quelques secondes par la connexion temps réel de SmartHQ. Deux déclencheurs
de scène (« cycle terminé », « alerte d'un appareil »), une action de scène (mettre en pause ou arrêter
un lave-vaisselle) et un widget de tableau de bord (appareils en marche, temps restant) complètent les
appareils.

**La sécurité d'abord** : rien de ce qui chauffe n'est jamais démarré à distance. Fours, cuisinières et
chauffe-eau sont en lecture seule ; un lave-vaisselle peut être mis en pause ou arrêté, jamais démarré ;
lave-linge et sèche-linge sont en lecture seule.

Développée sans le matériel : vos retours sont les bienvenus. Cette intégration n'a aucun lien avec GE
Appliances ni Haier ; GE, SmartHQ, Café, Monogram, Profile et Hotpoint sont leurs marques.

## Prérequis

- Gladys Assistant 5.1.0 ou plus récent.
- Des appareils déjà associés dans l'application **SmartHQ** (l'application nord-américaine de GE
  Appliances), avec leur module Wi-Fi connecté.
- L'e-mail et le mot de passe de ce compte SmartHQ. Un compte protégé par un code de vérification
  (double authentification) fonctionne aussi : voir Configuration.
- Un accès à Internet depuis Gladys : les appareils GE n'ont pas d'API locale, tout passe par le cloud
  SmartHQ.

## Configuration

1. Dans Gladys, ouvrez **Intégrations**, installez **GE Appliances (SmartHQ)**, puis ouvrez son onglet
   **Configuration**.
2. Renseignez l'**e-mail** et le **mot de passe** de votre compte SmartHQ. Laissez la **région du
   compte** sur « États-Unis », sauf si votre compte a été créé en Europe.
3. Choisissez l'**unité de température** (°C par défaut ; les appareils GE fonctionnent en °F et les
   valeurs sont converties) et la **langue** des noms de fonctionnalités. Choisissez les deux avant
   d'ajouter les appareils : noms et unités d'un appareil sont figés à son ajout.
4. Enregistrez. L'état passe à « connecté » et les appareils apparaissent dans l'onglet **Découverte** :
   ajoutez ceux que vous voulez.
5. Si SmartHQ demande un **code de vérification**, l'état le dit. Lancez l'action **Envoyer le code de
   vérification** (SmartHQ l'envoie par e-mail), puis **Saisir le code de vérification** avec le code
   reçu, sous 15 minutes. L'intégration garde ensuite un jeton de rafraîchissement dans son volume
   privé : aucun code n'est redemandé au redémarrage suivant.

L'action **Tester la connexion** liste les appareils du compte.

Un mot de passe refusé n'est jamais réessayé tant que vous ne l'avez pas changé et enregistré : des
essais répétés pourraient bloquer le compte. Si SmartHQ demande d'accepter de nouvelles conditions
d'utilisation, acceptez-les dans l'application SmartHQ, puis enregistrez de nouveau la configuration :
l'intégration n'accepte jamais de conditions à votre place.

## Les appareils

Un appareil Gladys par appareil GE, nommé d'après son surnom dans SmartHQ. Une fonctionnalité n'est
créée que si l'appareil donne la valeur qui la nourrit.

- **Lave-linge, sèche-linge, lavantes-séchantes** : état, programme (noms GE, en anglais), temps
  restant, fin prévue, départ différé, porte, alertes (problème de vidange, évacuation du sèche-linge
  bouchée). Lecture seule.
- **Lave-vaisselle** : état, programme, phase du cycle (prélavage, lavage principal, séchage…), temps
  restant, fin prévue, porte, commande à distance activée, alertes (liquide de rinçage bas, filtre à
  nettoyer). Mise en pause ou arrêt par l'action de scène seulement.
- **Fours et cuisinières** : pour chaque cavité (haut et bas d'un four double), état (préchauffage,
  cuisson, maintien au chaud, nettoyage…), température atteinte, température de consigne, temps restant
  d'une cuisson minutée, minuteur. Lecture seule : aucun réglage, aucun démarrage.
- **Réfrigérateurs et caves à boissons** : températures du réfrigérateur et du congélateur,
  **consignes** du réfrigérateur et du congélateur (modifiables, dans les limites données par
  l'appareil), porte (ouverte dès qu'une porte l'est), état et durée de vie du filtre à eau, alertes
  (filtre, fuite, porte restée ouverte, trop chaud).
- **Climatiseurs** (fenêtre, mobile, split, encastré) : **marche/arrêt, mode** (froid, ventilation,
  déshumidification, chaud et auto selon l'appareil), **consigne** (en degrés entiers), **vitesse de
  ventilation** (auto, basse, moyenne, haute), température ambiante, alerte de filtre.
- **Chauffe-eau GeoSpring** : température de l'eau, consigne et mode, en lecture seule.
- **Machines à glaçons Opal** : état (production de glace, bac plein, ajouter de l'eau…) et alertes, en
  lecture seule.

Les portes suivent Gladys : 0 signifie ouverte, 1 fermée. Un appareil déconnecté de SmartHQ garde ses
dernières valeurs, affiche « Non connecté » comme état, et son badge passe à « injoignable ».

## Widget

Le widget **Appareils GE** liste ce qui tourne : lave-linge, sèche-linge, lave-vaisselle et fours, le
plus occupé d'abord, avec le programme, la phase et la fin prévue, et un badge avec le temps restant (ou
« En pause », « Terminé », « Alarme »). Quand rien ne tourne, une ligne le dit. Il se rafraîchit chaque
minute et dès qu'un appareil démarre ou s'arrête.

## Déclencheurs et action de scène

- **Cycle GE terminé** : un lave-linge, sèche-linge ou lave-vaisselle a terminé son cycle, ou la cuisson
  minutée d'un four est finie. Filtre : l'appareil. Variables : nom de l'appareil, programme.
- **Alerte d'un appareil GE** : un appareil lève une nouvelle alerte (porte restée ouverte, fuite
  d'eau, filtre à eau, liquide de rinçage, évacuation du sèche-linge bouchée, filtre du climatiseur,
  machine à glaçons…). Filtres : l'appareil, les alertes. Variables : nom de l'appareil, alerte (dans la
  langue configurée), code de l'alerte.
- **Pause ou arrêt d'un lave-vaisselle GE** (action) : met en pause ou arrête le cycle d'un
  lave-vaisselle dont la commande à distance est activée sur l'appareil. Elle ne démarre ni ne reprend
  jamais un cycle. Sortie : commande envoyée.

Un déclencheur part une fois par transition, jamais au démarrage.

## Exemples de scènes

- **Lessive finie** : déclencheur « Cycle GE terminé » sur le lave-linge → envoyer le message « Le
  lave-linge a fini ({{triggerEvent.data.cycle}}) » à la famille.
- **Porte du frigo restée ouverte** : déclencheur « Alerte d'un appareil GE », alerte « Porte du
  réfrigérateur ouverte » → notification, et faire clignoter la lumière de la cuisine.
- **Heures calmes** : à 22 h → « Pause ou arrêt d'un lave-vaisselle GE » avec « Mettre en pause »
  (refusée sans conséquence quand rien ne tourne).
- **Rafraîchir la chambre avant le coucher** : à 21 h en été → climatiseur de la chambre en marche, mode
  froid, consigne 22 °C.

## Rafraîchissement et quotas

L'intégration ne compte pas sur le sondage de Gladys, peu fiable pour les intégrations externes
(GladysAssistant/Gladys#3198) : elle garde ouverte une connexion temps réel SmartHQ, reçoit chaque
changement en quelques secondes, et relit d'elle-même tous les appareils toutes les 10 minutes (le filet
de sécurité, et le battement des valeurs qui ne changent jamais). Gladys ne reçoit que les valeurs qui
changent, et une valeur inchangée de nouveau toutes les 6 heures.

GE ne publie ni conditions d'utilisation de l'API ni quota pour SmartHQ. L'intégration suit le rythme de
gehomesdk, la bibliothèque de l'intégration Home Assistant : une connexion, un maintien en vie toutes
les 30 secondes, la liste des appareils toutes les 10 minutes, des commandes seulement quand vous
agissez. Une connexion perdue est rouverte après 10 secondes, puis 20, 40… jusqu'à 15 minutes.

## Dépannage

- **« SmartHQ a refusé l'e-mail ou le mot de passe »** : vérifiez-les dans l'application SmartHQ,
  corrigez-les, enregistrez.
- **« SmartHQ demande un code de vérification »** : lancez « Envoyer le code de vérification », puis
  « Saisir le code de vérification » sous 15 minutes.
- **« Nouvelles conditions d'utilisation »** : ouvrez l'application SmartHQ, acceptez-les, puis
  enregistrez de nouveau la configuration.
- **Un appareil manque** : il doit apparaître dans l'application SmartHQ du même compte. Les types non
  pris en charge (micro-ondes, plaques, hottes, fours grille-pain…) ne sont pas publiés ; les journaux le
  disent une fois.
- **Températures dans la mauvaise unité** : changez l'unité, enregistrez, puis utilisez **Mettre à
  jour** sur l'appareil dans l'onglet Découverte (ou supprimez-le et ajoutez-le de nouveau).
- **Plus de détails** : réglez `LOG_LEVEL=debug` sur l'intégration. Les journaux ne contiennent jamais
  le mot de passe, les jetons ni l'adresse de connexion.

## Limites

- Développée et testée sans appareil GE ni compte SmartHQ, sur des valeurs construites d'après
  gehomesdk : vos retours sont les bienvenus, surtout sur les valeurs que donnent vos appareils.
- Cloud uniquement : sans Internet, rien n'est mis à jour.
- Les portes des fours, les distributeurs des réfrigérateurs et les machines à glaçons intégrées aux
  réfrigérateurs ne figurent pas dans les données lues par l'intégration.
- Lave-linge et sèche-linge ne peuvent être mis en pause ni arrêtés à distance (GE n'expose pas cette
  commande) ; un lave-vaisselle seulement si sa commande à distance est activée sur l'appareil.
- Micro-ondes, Advantium, plaques de cuisson, hottes, déshumidificateurs, cafetières, filtres et
  adoucisseurs d'eau ne sont pas encore pris en charge.
- Les noms des programmes de lavage et de séchage restent en anglais, tels que GE les nomme.

// Service worker minimal : met en cache la coquille de l'app pour qu'elle
// s'ouvre même sans réseau.
//
// Important : stratégie "réseau d'abord, cache en secours" (voir plus bas).
// Avec l'ancienne stratégie "cache d'abord", une mise à jour livrée sur
// GitHub Pages restait invisible sur un téléphone qui avait déjà installé
// l'app tant que ce fichier sw.js lui-même ne changeait pas d'un octet -
// exactement le bug que Christine a rencontré le 10/09/2026 (page restée
// figée sur une très vieille version malgré plusieurs mises à jour
// poussées entre-temps). Ne pas revenir à "cache d'abord" pour l'app
// shell sans revoir ce commentaire.
const CACHE_NAME = "carnet-muscu-v53";
// (v18 regroupe : renommer une séance + graphique "séances par mois")
// (v19 : corrige les compteurs "utilisé X×" faussés dans la bibliothèque)
// (v20 : synchro robuste - horodatage systématique + fusion par version la
// plus récente au lieu d'un simple écrasement, pour ne jamais perdre de
// données entre deux appareils)
// (v21 : import d'une séance depuis une photo, lue automatiquement par IA -
// voir js/ai.js - toujours un brouillon à valider avant enregistrement)
// (v22 : le message d'erreur d'import IA affiche le détail technique, pour
// diagnostiquer sans avoir besoin d'ouvrir la console du navigateur)
// (v23 : corrige l'adresse de la fonction Firebase pour l'import IA, qui
// était restée un texte d'exemple jamais remplacé)
// (v24 : import IA - date modifiable, boutons +/- pour le nombre de tours,
// affichage du gif de l'exercice choisi + bouton de diagnostic des favoris)
// (v25 : corrige le bug des favoris qui revenaient après synchro + permet de
// modifier la date d'une séance déjà enregistrée)
// (v26 : diagnostic des favoris enrichi - version du cache, état de la
// synchro, et pour chaque favori : date de dernière écriture et si elle a eu
// lieu sur cet appareil dans la dernière heure - pour identifier précisément
// ce qui réécrit un favori)
// (v27 : corrige la VRAIE cause du bug des favoris qui revenaient -
// bumpLibraryUsage() forçait le favori à true à CHAQUE ajout/remplacement/
// duplication d'un exercice dans une séance, pas seulement la première fois,
// et écrasait donc systématiquement un favori retiré à la main entre-temps.
// Ne s'applique plus qu'à la toute première utilisation. Corrige aussi un
// cas limite dans la fusion de synchro - comparaison stricte "<" au lieu de
// "<=" sur des horodatages identiques)
// (v28 à v36 : tentative d'implémenter le partage de photo depuis WhatsApp
// via le "share_target" du manifest.json, avec un diagnostic de plus en plus
// détaillé côté service worker. Abandonné en v37 : le diagnostic a montré
// qu'Android/Chrome ne transmet pas de façon fiable la photo réelle à
// l'appli - WhatsApp n'envoie parfois qu'une description texte, et un
// partage depuis l'appli Photos peut arriver avec un corps entièrement vide,
// sans que le code de l'appli n'y puisse rien : le problème se situe avant
// même que ce fichier ne reçoive quoi que ce soit. Christine utilise
// désormais uniquement le bouton "Importer une photo de séance" du journal.)
// (v29 : corrige les suppressions d'exercices de la bibliothèque (ex. les
// doublons repérés via le diagnostic) qui revenaient toutes seules après une
// synchro - mergeBackupData() ne supprimait jamais rien de lui-même, donc une
// vieille version encore présente ailleurs (autre appareil, cloud) réimportait
// l'exercice supprimé. Chaque suppression pose maintenant une "tombe"
// (id + date) qui est elle-même synchronisée, pour que les autres appareils
// sachent qu'il faut supprimer plutôt que réimporter)
// (v30 : corrige un compteur "utilisé X×" qui pouvait rester faux pour
// toujours - la synchro copiait ce chiffre tel quel depuis un autre appareil
// ou une vieille sauvegarde cloud au lieu de le recalculer depuis les
// vraies séances présentes ici. Cas réel : "Kettlebell alternating renegade
// row" marqué utilisé alors qu'absent de Progrès et de toute séance)
// (v32 : affiche la version installée directement dans la modale de
// synchro - à la demande de Christine, pour vérifier facilement qu'une
// mise à jour a bien été récupérée, sans passer par le bouton diagnostic)
// (v37 : retire tout le code de partage de photo (share_target, cache de
// partage, diagnostic dédié) - abandonné, voir ci-dessus. Ajoute une
// estimation du temps restant pendant l'analyse IA d'une photo (js/ai.js,
// js/app.js) et l'accès aux gifs/filtres de la bibliothèque lors du choix
// d'un exercice dans le brouillon d'import (js/app.js))
// (v38 : la v37 avait gardé, en plus du nouveau bouton gifs/filtres, l'ancien
// menu déroulant à choix limité (noms bruts en anglais, sans gif) - toujours
// visible et source de confusion. Le retire complètement : le nom de
// l'exercice actuellement rattaché à la ligne s'affiche en simple texte, et
// le bouton "choisir un exercice (gifs / filtres)" devient l'unique façon de
// choisir ou changer l'exercice d'une ligne du brouillon d'import)
// (v39 : corrige deux défauts remontés par Christine sur la modale de
// recherche d'exercice (gifs/filtres) - 1) le plafond de 8 résultats
// affichés masquait silencieusement des favoris dès qu'elle en avait plus
// que ça ; ne s'applique plus que si aucun filtre ni recherche texte n'est
// actif (sinon tout ce qui correspond est affiché). 2) l'intitulé "Favoris"
// au-dessus des boutons "Tout" / "★ Favoris" répétait le nom d'un des deux
// boutons, jugé "bizarre" - renommé en "Filtrer")
// (v40 : la recherche d'exercice (bibliothèque et modale gifs/filtres)
// triait toujours par ordre alphabétique, y compris pendant une recherche
// texte - remonté par Christine : chercher "fentes" faisait apparaître des
// exercices composés (curl, extension triceps... combinés à une fente) au
// même niveau que "lunge" ou "dumbbell lunge", noyés au milieu par l'ordre
// alphabétique. Ajoute un tri par pertinence (voir searchRelevanceScore et
// sortByRelevance dans js/app.js) qui privilégie une correspondance directe
// et un nom court, appliqué uniquement pendant une recherche texte -
// l'ordre alphabétique reste utilisé pour parcourir sans rien taper)
// (v41 : onglet progrès, à la demande de Christine du 14/09/2026 - 1) la
// liste était triée par nombre de séances décroissant, ce qui la remélangeait
// à chaque nouvelle séance ; trie maintenant par ordre alphabétique. 2) les
// noms d'exercice (jeu de données en anglais, tout minuscules) affichent
// maintenant une majuscule sur la première lettre seulement (voir
// capitalizeFirst dans js/app.js))
// (v42 : onglet progrès, suite aux précisions de Christine du 14/09/2026 -
// 1) quand plusieurs tours d'une séance ont des poids différents, la valeur
// du graphique était le tour le plus lourd ; c'est maintenant le poids du
// DERNIER tour renseigné qui est utilisé. 2) un exercice ajouté à une
// séance sans jamais avoir indiqué de poids (ni de répétitions pour un
// exercice au poids du corps) n'apparaît plus dans la liste progrès - il
// n'y a rien à y montrer)
// (v43 : onglet progrès - Christine a précisé que les exercices au poids du
// corps ou à l'élastique (planche, montée de corde…) ne doivent jamais
// apparaître dans progrès, même s'ils ont des répétitions enregistrées :
// cet onglet ne concerne que le suivi de charge)
// (v44 : le geste de retour du téléphone (balayer du bord gauche vers la
// droite en PWA installée sur Android) fermait l'appli faute d'historique
// de navigation interne - demande de Christine du 14/09/2026, depuis
// n'importe quel écran. goTo() empile maintenant une entrée d'historique à
// chaque changement d'écran, et un écouteur "popstate" intercepte ce
// retour pour rouvrir le journal plutôt que de laisser le geste continuer)
// (v45 : corrige un risque de perte de données trouvé en relecture de code -
// mergeBackupData() ne protégeait la fusion "le plus récent gagne" que si
// l'enregistrement REÇU avait un horodatage "updatedAt" renseigné ; un
// enregistrement reçu sans cet horodatage (vieil export json d'avant
// l'existence du champ, ou fichier modifié à la main) pouvait donc écraser
// sans condition une version locale plus récente. Un horodatage absent
// compte maintenant comme "le plus vieux possible" plutôt que de désactiver
// la comparaison)
// (v46 : trois corrections de maintenabilité issues de la même relecture de
// code, sans changement visible pour Christine - 1) buildChipRowCustom()
// resynchronise maintenant le chip surligné à chaque appel au lieu d'une
// seule fois à la construction, ce qui permet de retirer le contournement
// qui comparait le libellé affiché à des chaînes en dur ("★ Favoris",
// "Tout"...) dans openExerciseModal(). 2) la boucle de recherche dans le
// dictionnaire de synonymes était dupliquée entre matchesSearch() et
// searchRelevanceScore() - factorisée dans synonymTermsFor(). 3) le tri de
// Db.getAllLibraryExercises() ignorait la casse/accents contrairement au
// reste de l'appli - ajoute sensitivity:"base")
// (v47 : modèle "matériel" unifié, à la demande de Christine du 16/09/2026 -
// 1) le matériel d'un exercice (Haltères/Barre/Banc/Câble/Machine/
// Kettlebell/…) se change maintenant depuis sa fiche bibliothèque ("Changer
// le matériel"), et ce changement met aussi à jour les séances déjà
// enregistrées avec cet exercice. 2) le matériel "Banc" ne demande plus de
// poids à saisir, comme poids du corps/élastique. 3) un exercice peut avoir
// des matériels secondaires (en plus du principal) juste pour le retrouver
// dans plusieurs filtres, sans toucher à la saisie de poids. Les exercices du
// jeu de données déjà importés avant cette version sont reclassés une seule
// fois au démarrage (câble/machine/kettlebell/banc n'existaient pas comme
// matériel principal avant)
// (v48 : import d'une séance depuis une photo - quand l'IA ne retrouve
// aucune correspondance dans la bibliothèque pour un exercice lu sur la
// photo, la création de la séance n'est plus bloquée (demande de Christine
// du 16/09/2026) : le nom détecté est gardé tel quel comme un tout nouvel
// exercice de bibliothèque, modifiable ensuite depuis sa fiche)
// (v49 : suite aux retours de Christine du 16/09/2026 sur le matériel -
// 1) changer le matériel principal ou secondaire d'un exercice s'enregistre
// maintenant directement à chaque choix, sans bouton "Enregistrer" séparé
// (elle trouvait bizarre d'avoir à "enregistrer deux fois") - "Terminé" ne
// fait plus que refermer le panneau. 2) ajoute "Box" et "Médecine ball" comme
// matériels possibles. 3) les mots anglais "dumbbell"/"barbell" restés dans
// le nom de beaucoup d'exercices du jeu de données sont traduits en
// "haltère"/"barre")
// (v50 : suite de la traduction des noms d'exercices, à la demande de
// Christine du 16/09/2026 - traduit aussi "arm"/"leg"/"standing"/
// "bodyweight" en "bras"/"jambe"/"debout"/"poids du corps". La quasi-
// totalité des ~1300 noms du jeu de données reste en anglais (curl, press,
// cable, row, squat, bench...) - seuls les mots traduits jusqu'ici le sont)
// (v51 : deux corrections remontées par Christine le 18/09/2026 -
// 1) le champ de poids "libre" (haltères/barre) n'acceptait pas la virgule
// française ("0,5") : un clavier français tape une virgule que le champ,
// codé en <input type="number">, ne reconnaissait pas comme un nombre
// décimal valide. Passe en champ texte avec clavier décimal, qui accepte
// aussi bien "0,5" que "0.5". 2) la ligne "Dernière fois" d'un exercice
// n'affichait que le poids/ressenti du 1er tour de la séance précédente,
// jamais un tour suivant - le ressenti pouvait donc sembler manquant alors
// qu'il avait bien été noté. Reprend maintenant le dernier tour renseigné,
// comme pour l'onglet Progrès)
// (v52 : corrige "le retour arrière ne fonctionne plus" remonté par
// Christine le 21/09/2026 - le geste de retour changeait bien d'écran en
// coulisse (voir goTo/popstate plus haut, inchangés depuis la v44), mais
// les fenêtres ouvertes par-dessus (fiche d'exercice, ajout, import IA,
// graphique...) ne se ferment que via une classe CSS "open" et n'étaient
// jamais fermées par ce geste : le changement d'écran se faisait donc
// invisible, masqué par la fenêtre restée ouverte, donnant l'impression
// que le retour ne faisait plus rien. Le geste de retour ferme maintenant
// d'abord une fenêtre ouverte s'il y en a une, et ne revient au journal
// que si aucune fenêtre n'est ouverte)
// (v53 : deux corrections liées à l'import photo par IA, suite au signalement
// de Christine le 21/09/2026 "j'ai des erreurs de temps en temps lors de
// l'upload d'une image" - 1) la fonction serveur (functions/index.js)
// retente maintenant automatiquement l'appel à Gemini jusqu'à 2 fois en cas
// d'erreur transitoire (surcharge 429/503, erreur 500/502/504 ponctuelle)
// avant d'abandonner, ce qui devrait résorber la plupart de ces échecs
// intermittents sans que Christine ait à reprendre la photo ; le message
// d'erreur distingue maintenant ce cas ("service surchargé, réessaie dans
// une minute") d'une vraie panne. 2) en marge de cette investigation,
// repéré et corrigé un bug d'affichage : les boutons "Créer la séance" /
// "Annuler" de cette même fenêtre d'import restaient visibles ET cliquables
// même pendant l'affichage d'un message d'erreur (un [hidden] sans son
// override CSS - même famille de bug que celui déjà corrigé pour le
// formulaire "nouvel exercice", voir commentaire css/app.css) : un clic
// dessus à ce moment-là aurait fait planter l'import puisqu'aucun brouillon
// n'existe encore)
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/app.css",
  "./js/db.js",
  "./js/sync.js",
  "./js/ai.js",
  "./js/app.js",
  "./data/exercises-library.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Stratégie "réseau d'abord, cache en secours" : avec une connexion, on
// prend toujours la dernière version en ligne (et on rafraîchit le cache
// au passage) ; sans connexion, on retombe sur la dernière copie connue.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // "reload" force le navigateur à revalider avec le serveur au lieu de
  // servir une copie de son propre cache HTTP (GitHub Pages envoie des
  // en-têtes de cache assez longs) - sans ça, "réseau d'abord" pouvait
  // quand même renvoyer une vieille version tant que ce cache HTTP-là
  // n'expirait pas, même juste après une mise à jour poussée sur GitHub.
  event.respondWith(
    fetch(event.request, { cache: "reload" })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});

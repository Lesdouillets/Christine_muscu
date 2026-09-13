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
const CACHE_NAME = "carnet-muscu-v37";
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

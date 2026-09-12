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
const CACHE_NAME = "carnet-muscu-v27";
// (v18 regroupe : renommer une séance + graphique "séances par mois")
// (v19 : corrige les compteurs "utilisé X×" faussés dans la bibliothèque)
// (v20 : synchro robuste - horodatage systématique + fusion par version la
// plus récente au lieu d'un simple écrasement, pour ne jamais perdre de
// données entre deux appareils)
// (v21 : import d'une séance depuis une photo, lue automatiquement par IA -
// voir js/ai.js - toujours un brouillon à valider avant enregistrement)
// (v22 : le message d'erreur d'import IA affiche le détail technique, pour
// diagnostiquer sans avoir besoin d'ouvrir la console du navigateur)
// (v23 : corrige l'adresse de la fonction Firebase dans js/ai.js - une
// adresse provisoire "<A_COMPLETER>" n'avait jamais été remplacée par la
// vraie, donc l'import IA échouait toujours en pratique malgré des tests
// serveur qui, eux, passaient)
// (v24 : import IA - date modifiable, stepper +/- pour les tours, GIF affiché
// pour l'exercice choisi ; ajoute un bouton temporaire "diagnostiquer les
// favoris" pour comprendre le souci de favoris qui disparaissent/reviennent)
// (v25 : corrige un vrai bug de synchro - un favori enlevé pouvait redevenir
// favori ~4s plus tard à cause de l'envoi automatique vers le cloud ; ajoute
// aussi la possibilité de modifier la date d'une séance déjà enregistrée)
// (v26 : diagnostic des favoris enrichi - version du cache, etat de la
// synchro, et pour chaque favori : date de derniere ecriture et si elle a eu
// lieu sur cet appareil dans la derniere heure - pour identifier precisement
// ce qui reecrit un favori)
// (v27 : corrige la VRAIE cause du bug des favoris qui revenaient -
// bumpLibraryUsage() forcait le favori a true a CHAQUE ajout/remplacement/
// duplication d'un exercice dans une seance, pas seulement la premiere fois,
// et ecrasait donc systematiquement un favori retire a la main entre-temps.
// Ne s'applique plus qu'a la toute premiere utilisation. Corrige aussi un
// cas limite dans la fusion de synchro - comparaison stricte "<" au lieu de
// "<=" sur des horodatages identiques)
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
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
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

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
const CACHE_NAME = "carnet-muscu-v21";
// (v18 regroupe : renommer une séance + graphique "séances par mois")
// (v19 : corrige les compteurs "utilisé X×" faussés dans la bibliothèque)
// (v20 : synchro robuste - horodatage systématique + fusion par version la
// plus récente au lieu d'un simple écrasement, pour ne jamais perdre de
// données entre deux appareils)
// (v21 : import d'une séance depuis une photo, lue automatiquement par IA -
// voir js/ai.js - toujours un brouillon à valider avant enregistrement)
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

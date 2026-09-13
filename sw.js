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
const CACHE_NAME = "carnet-muscu-v35";
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
// (v28 : implémente vraiment le partage de photo depuis WhatsApp (manifest.json
// déclarait déjà "share_target" mais rien ne le gérait - une erreur 405 était
// inévitable, GitHub Pages ne pouvant jamais répondre à un POST puisque c'est
// un hébergement statique. Le service worker intercepte maintenant lui-même
// cet envoi - avant qu'il n'atteigne le serveur -, garde la photo de côté, et
// redirige vers l'appli qui ouvre directement l'import IA avec cette photo)
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
// (v31 : le partage de photo WhatsApp ouvrait bien l'appli mais jamais
// l'import quand elle était déjà ouverte en arrière-plan - Android se
// contentait de ramener cette fenêtre au premier plan sans lui faire
// charger la redirection. sw.js prévient maintenant directement toute
// fenêtre déjà ouverte par un message, en plus de la redirection)
// (v32 : affiche la version installée directement dans la modale de
// synchro - à la demande de Christine, pour vérifier facilement qu'une
// mise à jour a bien été récupérée, sans passer par le bouton diagnostic)
// (v33 : le partage WhatsApp restait silencieux même appli fermée - ajoute
// une trace de diagnostic persistante (visible dans la modale de synchro)
// pour savoir, sans câble USB, si la redirection/le message est seulement
// reçu et si une photo est bien retrouvée dans le cache)
// (v34 : le diagnostic v33 a montré que le signal de partage arrive bien
// (redirection + message reçus) mais qu'aucune photo n'est jamais trouvée
// dans le cache - la trace v33 ne pouvait pas dire pourquoi, puisque tout
// se passe dans handleSharedPhoto() ci-dessous, côté service worker, sans
// accès à localStorage. Ajoute une trace technique détaillée (Cache API,
// clé "debug") : type de contenu reçu, noms des champs du formulaire,
// présence/type/taille du champ "photo", ou l'erreur exacte si la lecture
// a échoué - relue et affichée par consumeSharedPhotoFromCache/
// renderAppVersionLabel dans js/app.js)
// (v35 : le diagnostic v34 a montré, sur DEUX chemins de partage WhatsApp
// différents (bulle du message, puis photo plein écran), exactement le même
// résultat - seul un champ "title" arrive, jamais de champ "photo" ni "text".
// Capture maintenant la VALEUR de "title"/"text" (et plus seulement leur
// présence), pour comprendre ce qu'Android envoie réellement à la place
// d'une photo)
const SHARE_CACHE = "carnet-muscu-shared-photo";
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
        // SHARE_CACHE n'est pas un cache de version de l'appli (voir
        // CACHE_NAME plus haut) mais une "boîte aux lettres" temporaire pour
        // une photo tout juste partagée depuis une autre appli - il ne faut
        // surtout pas le supprimer ici comme les vieux caches d'appli.
        keys.filter((k) => k !== CACHE_NAME && k !== SHARE_CACHE).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Reçoit une photo partagée depuis une autre appli (WhatsApp, galerie...) via
// le "share_target" déclaré dans manifest.json. Android envoie un vrai POST
// (multipart/form-data) vers ce fichier - mais GitHub Pages est un hébergement
// statique qui ne sait répondre qu'à des GET, donc ce POST échouerait toujours
// avec une erreur 405 s'il l'atteignait. On l'intercepte ici, avant qu'il ne
// quitte l'appareil : on garde la photo de côté (Cache API, seul stockage
// simple accessible depuis un service worker) puis on redirige vers l'appli
// normale, qui la récupère et ouvre directement l'import IA avec (voir
// checkForSharedPhoto dans js/app.js).
async function handleSharedPhoto(request) {
  let stored = false;
  // Diagnostic (v34, 13/09/2026) : le catch ci-dessous avalait silencieusement
  // toute erreur - Christine a confirmé que le signal de partage arrive bien
  // (redirection + message reçus), mais qu'aucune photo n'est jamais trouvée
  // dans le cache. Cette trace, elle, dit précisément POURQUOI la lecture du
  // fichier a échoué (contrairement à localStorage, un service worker ne peut
  // écrire son diagnostic que dans le Cache API - consumeSharedPhotoFromCache
  // dans js/app.js la relit et la fusionne avec sa propre trace).
  const debugInfo = { contentType: request.headers.get("content-type") || null };
  try {
    const formData = await request.formData();
    debugInfo.formDataKeys = [...formData.keys()];
    // Diagnostic (v35, 13/09/2026) : deux chemins de partage WhatsApp
    // différents (bulle du message vs photo plein écran) ont donné exactement
    // le même résultat - seul un champ "title" arrive, jamais de photo ni de
    // texte. Pour comprendre ce qu'Android envoie réellement, on capture
    // maintenant la VALEUR de ces champs texte (tronquée par sécurité), pas
    // seulement leur présence.
    for (const key of ["title", "text"]) {
      const value = formData.get(key);
      if (typeof value === "string") {
        debugInfo[key + "Value"] = value.slice(0, 300);
      }
    }
    const file = formData.get("photo");
    debugInfo.hasPhotoField = !!file;
    if (file) {
      debugInfo.photoIsFile = typeof file.arrayBuffer === "function";
      debugInfo.photoType = file.type;
      debugInfo.photoSize = file.size;
    }
    if (file && typeof file.arrayBuffer === "function") {
      const cache = await caches.open(SHARE_CACHE);
      await cache.put(
        "photo",
        new Response(file, { headers: { "Content-Type": file.type || "application/octet-stream" } })
      );
      stored = true;
    }
  } catch (err) {
    // Partage sans photo exploitable (ex. juste du texte) - on redirige quand
    // même vers l'appli plutôt que de laisser une erreur s'afficher.
    debugInfo.error = String((err && err.message) || err);
  }
  try {
    const cache = await caches.open(SHARE_CACHE);
    await cache.put("debug", new Response(JSON.stringify(debugInfo), { headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    // pas grave, purement informatif
  }
  // Si une fenêtre de l'appli est déjà ouverte (en arrière-plan par exemple),
  // Android/Chrome se contente souvent de la ramener au premier plan SANS
  // jamais lui faire charger la redirection ci-dessous - constaté avec
  // Christine le 14/09/2026 (l'appli s'ouvrait, mais jamais l'import). On la
  // prévient donc directement par message, en plus de la redirection
  // (nécessaire, elle, quand aucune fenêtre n'était déjà ouverte).
  if (stored) {
    const allClients = await self.clients.matchAll({ type: "window" });
    for (const client of allClients) {
      client.postMessage({ type: "carnet-muscu-shared-photo" });
    }
  }
  return Response.redirect(new URL("index.html?photo-partagee=1", self.location.href).href, 303);
}

// Stratégie "réseau d'abord, cache en secours" : avec une connexion, on
// prend toujours la dernière version en ligne (et on rafraîchit le cache
// au passage) ; sans connexion, on retombe sur la dernière copie connue.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname.endsWith("/import.html")) {
    event.respondWith(handleSharedPhoto(event.request));
    return;
  }
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

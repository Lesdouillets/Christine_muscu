// Synchronisation cloud entre appareils (Android + Mac de Christine), via
// Firebase Firestore. Choix volontairement simple, sans écran de connexion :
// pas de compte, pas de mot de passe - un « code de synchronisation » généré
// aléatoirement (assez long pour ne pas être devinable) sert à la fois
// d'identifiant et de clé d'accès au document Firestore correspondant.
//
// Contrepartie assumée : quiconque connaît ce code peut lire/écrire les
// données qui lui sont associées (voir les règles Firestore, qui exigent
// simplement un code d'au moins 20 caractères - pas de vraie authentification
// utilisateur). C'est un compromis raisonnable pour des séances de muscu,
// pas pour des données sensibles. Christine a été informée de ce compromis
// avant qu'on parte sur cette solution plutôt qu'un vrai compte.
//
// Format du document Firestore (collection "syncs", un document par code) :
//   { version: 1, updatedAt: <ISO>, sessions: [...], library: [...] }
// -> exactement le même format que l'export/import JSON existant (voir
// buildBackupPayload/mergeBackupData dans app.js), pour ne pas dupliquer la
// logique de fusion.

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDbiF0aXGKCiEwoowpz8nZCuy2rr2y-IfM",
  authDomain: "christinemuscu.firebaseapp.com",
  projectId: "christinemuscu",
  storageBucket: "christinemuscu.firebasestorage.app",
  messagingSenderId: "313439536760",
  appId: "1:313439536760:web:e8ca23cc4c1ba11718f8d",
};

const SYNC_CODE_KEY = "carnet-muscu-sync-code";
const SYNC_LAST_KEY = "carnet-muscu-sync-last";

let firestoreDb = null;
function getFirestore() {
  // Le SDK Firebase est chargé depuis un CDN (voir index.html) : sans
  // connexion (ou si le CDN est bloqué), `firebase` n'existe pas - mieux
  // vaut un message clair ("pas de connexion") qu'une ReferenceError brute.
  if (typeof firebase === "undefined") {
    throw new Error("Impossible de contacter le service de synchronisation (vérifie ta connexion internet).");
  }
  if (!firestoreDb) {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    firestoreDb = firebase.firestore();
  }
  return firestoreDb;
}

function getSyncCode() {
  return localStorage.getItem(SYNC_CODE_KEY) || null;
}
function setSyncCode(code) {
  localStorage.setItem(SYNC_CODE_KEY, code);
}
function forgetSyncCode() {
  stopRealtimeSync();
  Db._onWrite = null;
  localStorage.removeItem(SYNC_CODE_KEY);
  localStorage.removeItem(SYNC_LAST_KEY);
}
function getLastSyncLabel() {
  const iso = localStorage.getItem(SYNC_LAST_KEY);
  if (!iso) return null;
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}
function setLastSyncNow() {
  localStorage.setItem(SYNC_LAST_KEY, new Date().toISOString());
}

// Génère un code assez long pour ne pas être devinable ni brute-forçable
// (voir la règle Firestore côté serveur qui exige >= 20 caractères) : 30
// caractères tirés d'un alphabet de 36, soit largement plus d'entropie
// qu'un mot de passe classique.
function generateSyncCode() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(30);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

// ---------- Synchronisation automatique en temps réel ----------
// À la demande de Christine (10/09/2026) : plus besoin de cliquer sur les
// boutons pour que ce soit à jour. Deux mécanismes complémentaires :
//  - un envoi automatique (débouncé) dès qu'une donnée locale change,
//    branché via Db._onWrite (voir js/db.js) ;
//  - une écoute en direct (Firestore onSnapshot) du document cloud, qui
//    fusionne automatiquement tout changement fait sur l'autre appareil.
// Uniquement pendant que l'appli est ouverte au premier plan (pas en
// arrière-plan) - c'est ce que Christine a demandé, et ça évite de garder
// une connexion réseau ouverte pour rien quand elle n'utilise pas l'appli.

let realtimeUnsubscribe = null;
let pushDebounceTimer = null;

// Empêche la fusion d'un changement reçu du cloud de re-déclencher elle-même
// un envoi automatique (qui renverrait aussitôt exactement ce qu'on vient de
// recevoir) : le hook Db._onWrite est simplement coupé pendant la fusion,
// puis restauré - voir mergeBackupData dans app.js.
function scheduleAutoPush() {
  const code = getSyncCode();
  if (!code) return;
  clearTimeout(pushDebounceTimer);
  // Un léger délai regroupe plusieurs modifications rapprochées (ex. saisir
  // plusieurs séries d'affilée) en un seul envoi, au lieu d'un envoi par
  // clic.
  pushDebounceTimer = setTimeout(async () => {
    try {
      await pushBackupToCloud();
    } catch (err) {
      // Erreur silencieuse ici (pas d'alerte) : une synchro automatique en
      // arrière-plan de la saisie ne doit pas interrompre Christine en
      // pleine séance. Le bouton manuel "Sauvegarder" reste disponible et
      // affichera l'erreur si besoin.
      console.error("[carnet-muscu] échec de la synchro automatique :", err);
    }
    renderSyncSection();
  }, 4000);
}

function startRealtimeSync() {
  const code = getSyncCode();
  if (!code) return;
  stopRealtimeSync();
  if (typeof firebase === "undefined") return; // pas de réseau/CDN bloqué
  try {
    realtimeUnsubscribe = getFirestore()
      .collection("syncs")
      .doc(code)
      .onSnapshot(
        async (snap) => {
          // hasPendingWrites = c'est notre propre envoi qui nous revient en
          // écho (Firestore notifie l'auteur en local avant confirmation
          // serveur) - rien à fusionner, on l'a déjà.
          if (snap.metadata.hasPendingWrites || !snap.exists) return;
          try {
            // mergeBackupData coupe elle-même le hook Db._onWrite le temps de
            // la fusion (voir app.js) - pas besoin de le refaire ici.
            await mergeBackupData(snap.data());
            setLastSyncNow();
            renderSyncSection();
          } catch (err) {
            console.error("[carnet-muscu] échec de la fusion en temps réel :", err);
          }
        },
        (err) => {
          console.error("[carnet-muscu] écoute temps réel interrompue :", err);
        }
      );
  } catch (err) {
    console.error("[carnet-muscu] impossible de démarrer la synchro en temps réel :", err);
  }
}

function stopRealtimeSync() {
  if (realtimeUnsubscribe) {
    realtimeUnsubscribe();
    realtimeUnsubscribe = null;
  }
  clearTimeout(pushDebounceTimer);
}

// Coupe l'écoute temps réel quand l'appli passe en arrière-plan (onglet
// caché / appli minimisée sur le téléphone), la relance quand elle revient
// au premier plan - conformément à ce que Christine a demandé ("uniquement
// quand l'app est active"). Sans code configuré, ces appels ne font rien.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopRealtimeSync();
  } else {
    startRealtimeSync();
  }
});

// Construit la charge utile a envoyer au cloud, en laissant de cote le
// catalogue integre a l'appli (data/exercises-library.json, ~1300 exercices
// prefixes "ds-..." - voir seedPublicLibraryIfNeeded dans app.js). Ce
// catalogue est deja identique sur chaque appareil des le premier lancement :
// le renvoyer a chaque synchronisation n'apporte rien et suffisait a lui
// seul a depasser la limite Firestore (1 Mo), meme sans aucune photo
// personnelle - c'etait le vrai bug derriere le message "sauvegarde trop
// volumineuse" que Christine a rencontre avant qu'on comprenne l'origine.
// On ne garde donc, cote bibliotheque, que ce qui est propre a Christine :
// un exercice cree a la main, mis en favori, deja utilise, note, ou modifie
// (renomme / gif change, ce qui pose updatedAt).
async function buildCloudSyncPayload() {
  const full = await buildBackupPayload();
  const library = full.library.filter((ex) => {
    const isCustom = !String(ex.id).startsWith("ds-");
    return isCustom || ex.favorite || (ex.usageCount || 0) > 0 || ex.note || ex.updatedAt;
  });
  return { ...full, library };
}

// Envoie l'état local (filtré, voir buildCloudSyncPayload) vers le cloud,
// sous le code de sync actif. Remplace entièrement le document distant (une
// sauvegarde n'est pas une fusion : c'est un instantané de "l'état ici,
// maintenant").
async function pushBackupToCloud() {
  const code = getSyncCode();
  if (!code) throw new Error("Aucun code de synchronisation configuré.");
  // Avant d'envoyer, on récupère et fusionne d'abord ce qui est déjà dans le
  // cloud : Firestore .set() remplace tout le document, donc envoyer
  // directement un instantané local qui ne connaît pas encore un changement
  // fait sur l'autre appareil (et pas encore reçu ici, ex. réseau coupé un
  // moment) l'effacerait purement et simplement au prochain envoi - c'est
  // exactement la perte de données que Christine a demandé d'éliminer
  // (12/09/2026 : "je ne veux pas perdre des données, ne jamais prendre les
  // données en cache ou en local [plutôt que la version la plus récente]").
  // mergeBackupData ne fusionne que ce qui est plus récent (par updatedAt) et
  // n'efface jamais rien localement, donc cette étape ne peut qu'ajouter des
  // données manquantes ici, jamais en perdre.
  const remoteSnap = await getFirestore().collection("syncs").doc(code).get();
  if (remoteSnap.exists) {
    await mergeBackupData(remoteSnap.data());
  }
  const payload = await buildCloudSyncPayload();
  const json = JSON.stringify(payload);
  // Une limite Firestore existe par document (1 Mo). Une fois le catalogue
  // integre exclu (voir buildCloudSyncPayload), la cause la plus probable
  // d'un depassement est une photo/gif ajoutee en local (encodee en base64,
  // donc volumineuse). On le détecte avant l'envoi pour donner un message
  // clair plutôt qu'une erreur Firestore obscure.
  const approxBytes = new Blob([json]).size;
  if (approxBytes > 900000) {
    // On identifie le ou les exercices responsables (gif "file" = photo encodée
    // en base64, donc volumineuse) pour que Christine sache lequel corriger,
    // plutôt qu'un message vague qui l'oblige à chercher elle-même.
    const offenders = (payload.library || [])
      .filter((ex) => ex.gif && ex.gif.kind === "file" && ex.gif.value)
      .map((ex) => ({ name: ex.name, ko: Math.round(new Blob([ex.gif.value]).size / 1024) }))
      .sort((a, b) => b.ko - a.ko);
    const detail = offenders.length
      ? " En cause probable : " + offenders.slice(0, 3).map((o) => `« ${o.name} » (${o.ko} Ko)`).join(", ") + "."
      : "";
    throw new Error(
      "Ta sauvegarde est trop volumineuse pour le cloud (probablement à cause d'une photo/gif ajoutée depuis ton téléphone plutôt qu'un lien)." +
        detail +
        " Ouvre cet exercice dans la bibliothèque et clique sur « Changer le gif (par un lien) » pour pouvoir synchroniser."
    );
  }
  await getFirestore().collection("syncs").doc(code).set({
    version: 1,
    updatedAt: new Date().toISOString(),
    sessions: payload.sessions,
    library: payload.library,
    // Sans ça, une suppression (voir Db.deleteLibraryExercise et le
    // correctif du 13/09/2026) ne serait jamais transmise au cloud : l'autre
    // appareil (ou ce même appareil après une prochaine synchro) réimporterait
    // alors l'exercice supprimé comme s'il n'avait jamais disparu.
    libraryTombstones: payload.libraryTombstones || [],
  });
  setLastSyncNow();
}

// Récupère l'état depuis le cloud et le fusionne dans la base locale (voir
// mergeBackupData dans app.js - n'écrase jamais un changement local plus
// récent sur un exercice de bibliothèque, et n'efface jamais rien).
async function pullBackupFromCloud() {
  const code = getSyncCode();
  if (!code) throw new Error("Aucun code de synchronisation configuré.");
  const snap = await getFirestore().collection("syncs").doc(code).get();
  if (!snap.exists) {
    throw new Error("Aucune sauvegarde cloud trouvée pour ce code. Fais d'abord « Sauvegarder dans le cloud » depuis l'appareil qui a tes données.");
  }
  const data = snap.data();
  const result = await mergeBackupData(data);
  setLastSyncNow();
  return result;
}

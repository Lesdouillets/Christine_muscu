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

// Envoie l'état local complet vers le cloud, sous le code de sync actif.
// Remplace entièrement le document distant (une sauvegarde n'est pas une
// fusion : c'est un instantané de "l'état ici, maintenant").
async function pushBackupToCloud() {
  const code = getSyncCode();
  if (!code) throw new Error("Aucun code de synchronisation configuré.");
  const payload = await buildBackupPayload();
  const json = JSON.stringify(payload);
  // Une limite Firestore existe par document (1 Mo) - le cas le plus probable
  // pour la dépasser est une photo/gif ajoutée en local (encodée en base64,
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

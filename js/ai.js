// Lecture automatique d'une photo de séance par IA (vision), pour ne plus
// avoir à retaper à la main ce que Christine a déjà noté ailleurs (note
// manuscrite/numérique, capture d'écran d'un programme...) - demandé le
// 12/09/2026. Produit un BROUILLON de séance uniquement : rien n'est jamais
// enregistré tant que Christine n'a pas validé chaque exercice à l'écran
// (voir renderAiImportReview dans app.js) - c'est ce qu'elle a explicitement
// demandé plutôt qu'un remplissage automatique silencieux.
//
// La photo n'est PAS envoyée directement à l'API Gemini depuis le
// navigateur : une première version faisait ça avec la clé API directement
// dans ce fichier, mais GitHub a bloqué le push en détectant que cette clé
// est "liée à un compte de service" - un type de clé qui ne peut pas être
// restreint à un site précis (contrairement à une clé API classique), donc
// dangereux à exposer publiquement. Christine a choisi (12/09/2026) de
// passer par une petite fonction Firebase (functions/index.js, déployée sur
// le même projet Firebase que la synchro) qui garde la clé côté serveur et
// ne renvoie au navigateur que le résultat déjà lu. Voir functions/index.js
// pour la consigne donnée à l'IA et le format de réponse exact.
const AI_IMPORT_ENDPOINT = "https://analyzesessionphoto-<A_COMPLETER>.a.run.app";

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // reader.result = "data:image/jpeg;base64,AAAA..." - l'API Gemini veut
      // uniquement la partie après la virgule.
      const commaIndex = reader.result.indexOf(",");
      resolve(reader.result.slice(commaIndex + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Envoie la photo à notre fonction Firebase (qui elle-même interroge
// Gemini avec la clé gardée côté serveur) et renvoie
// { tours, exercises: [{name, reps, note}] }. Lève une erreur avec un
// message clair pour Christine en cas de souci (pas de réseau, fonction en
// échec, réponse imprévue...).
async function analyzeSessionPhoto(file) {
  const base64 = await fileToBase64(file);
  let response;
  try {
    response = await fetch(AI_IMPORT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mimeType: file.type || "image/jpeg", data: base64 }),
    });
  } catch (err) {
    throw new Error("Impossible de contacter le service de lecture de photo (vérifie ta connexion internet).");
  }
  if (!response.ok) {
    let detail = "";
    try {
      const errBody = await response.json();
      detail = errBody?.error ? ` (${errBody.error})` : "";
    } catch (_) {
      // corps d'erreur pas exploitable - tant pis, on garde le message générique
    }
    throw new Error(`Le service de lecture de photo a répondu une erreur${detail}.`);
  }
  let parsed;
  try {
    parsed = await response.json();
  } catch (err) {
    throw new Error("La réponse du service de lecture de photo n'était pas au format attendu.");
  }
  return {
    tours: Number.isInteger(parsed.tours) && parsed.tours > 0 ? parsed.tours : 1,
    exercises: Array.isArray(parsed.exercises)
      ? parsed.exercises
          .filter((e) => e && typeof e.name === "string" && e.name.trim())
          .map((e) => ({
            name: e.name.trim(),
            reps: Number.isInteger(e.reps) && e.reps > 0 ? e.reps : null,
            note: typeof e.note === "string" && e.note.trim() ? e.note.trim() : null,
          }))
      : [],
  };
}

// Retrouve le ou les exercices de bibliothèque qui ressemblent le plus à un
// nom lu sur la photo (l'IA peut mal orthographier, ou Christine a pu
// utiliser une variante du nom). Renvoie une liste triée, la meilleure
// correspondance en premier - à afficher comme suggestions, jamais
// sélectionnée automatiquement sans que Christine confirme (voir sa demande
// du 12/09/2026 : toujours valider avant d'enregistrer).
function normalizeForMatch(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // enleve les accents (formes combinantes apres normalize NFD)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchLibraryExercises(rawName, library, limit = 5) {
  const target = normalizeForMatch(rawName);
  const targetWords = target.split(" ").filter(Boolean);
  const scored = library.map((ex) => {
    const candidate = normalizeForMatch(ex.name);
    let score = 0;
    if (candidate === target) score = 100;
    else if (candidate.includes(target) || target.includes(candidate)) score = 70;
    else {
      const candidateWords = new Set(candidate.split(" ").filter(Boolean));
      const overlap = targetWords.filter((w) => candidateWords.has(w)).length;
      score = targetWords.length ? (overlap / targetWords.length) * 60 : 0;
    }
    return { ex, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.ex);
}

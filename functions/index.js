// Fonction serveur (Firebase Cloud Functions) qui sert d'intermédiaire entre
// l'appli (100% statique, sans backend) et l'API Gemini, pour lire une photo
// de séance envoyée par Christine (voir js/ai.js côté appli).
//
// Pourquoi cette fonction existe : une première version appelait Gemini
// directement depuis le navigateur, avec la clé API dans le code source.
// GitHub a bloqué le push en détectant que cette clé était "liée à un
// compte de service" - un type de clé qui ne peut PAS être restreint à un
// site précis (contrairement à une clé API classique), donc dangereux à
// rendre publique : n'importe qui l'aurait trouvée en inspectant le site et
// aurait pu l'utiliser sans limite. Christine a choisi (12/09/2026) cette
// solution : la clé reste ici, côté serveur, jamais envoyée au navigateur.
//
// Cette fonction ne fait qu'une chose : recevoir une image, demander à
// Gemini d'en extraire une séance de musculation, renvoyer le résultat déjà
// structuré. Elle ne touche à aucune donnée de Christine (pas de Firestore
// ici) - la création de la séance reste entièrement faite en local par
// l'appli, après validation de Christine (voir renderAiImportReview,
// js/app.js).
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

// La clé Gemini est stockée comme "secret" Firebase (jamais dans ce fichier,
// jamais dans le dépôt git) - voir la commande de déploiement dans
// functions/README.md pour la façon de la définir.
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const GEMINI_MODEL = "gemini-3.6-flash";

// N'accepte des requêtes que depuis le site de Christine (et localhost, pour
// pouvoir tester en local pendant le développement) - une protection en plus
// de la clé elle-même, qui ne fuit de toute façon jamais côté client.
const ALLOWED_ORIGINS = new Set([
  "https://lesdouillets.github.io",
  "http://localhost:8123",
]);

const AI_IMPORT_PROMPT = `Tu regardes la photo d'une séance de musculation notée par une utilisatrice
(note manuscrite, note numérique sur fond sombre, ou capture d'écran d'un
programme envoyé par quelqu'un). Extrais-en une structure JSON.

Règles :
- "tours" : le nombre de fois où le circuit doit être répété, si indiqué
  (ex. "5 Tours", "3 rounds"). Mets 1 si rien n'est indiqué.
- "exercises" : un élément par ligne d'exercice repérée, dans l'ordre où
  elles apparaissent. Pour chaque exercice :
  - "name" : le nom de l'exercice tel qu'écrit (corrige les fautes de frappe
    évidentes, mais ne traduis pas et n'invente pas un nom différent).
  - "reps" : le nombre de répétitions visé, en chiffres seulement (ex. 12).
    Si un nombre est donné par côté (ex. "10/10"), additionne-le (20).
    Mets null si aucun nombre n'est lisible.
  - "note" : toute précision entre parenthèses ou à côté (temps de pause,
    tempo, poids, côté...) recopiée telle quelle, ou null s'il n'y en a pas.
- Si l'image ne ressemble pas du tout à une séance de musculation (aucun
  exercice reconnaissable), renvoie "exercises": [].
- Ne renvoie strictement rien d'autre que le JSON demandé.`;

const AI_IMPORT_SCHEMA = {
  type: "object",
  properties: {
    tours: { type: "integer" },
    exercises: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          // Gemini (schéma proto/OpenAPI) n'accepte pas la syntaxe
          // JSON-Schema "type: [x, null]" pour un champ nullable - il faut
          // un "type" simple (une seule valeur) + "nullable: true" à côté.
          reps: { type: "integer", nullable: true },
          note: { type: "string", nullable: true },
        },
        required: ["name", "reps", "note"],
      },
    },
  },
  required: ["tours", "exercises"],
};

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Access-Control-Allow-Methods", "POST");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

exports.analyzeSessionPhoto = onRequest(
  { secrets: [GEMINI_API_KEY], region: "europe-west1", cors: true },
  async (req, res) => {
    setCors(req, res);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "Méthode non autorisée." });
      return;
    }
    const { mimeType, data } = req.body || {};
    if (!data || typeof data !== "string") {
      res.status(400).json({ error: "Image manquante." });
      return;
    }
    try {
      // Le format de clé le plus récent (préfixe "AQ.", délivré depuis
      // aistudio.google.com depuis août 2026) échoue avec "401
      // ACCESS_TOKEN_TYPE_UNSUPPORTED" si on la passe dans l'adresse
      // ("?key=...", l'ancienne façon de faire avec les clés "AIzaSy...").
      // Un en-tête "x-goog-api-key" est la façon attendue de l'envoyer pour
      // ce nouveau format - problème connu et documenté par d'autres
      // utilisateurs de Google AI Studio à la même période.
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": GEMINI_API_KEY.value(),
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: AI_IMPORT_PROMPT },
                  { inline_data: { mime_type: mimeType || "image/jpeg", data } },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: AI_IMPORT_SCHEMA,
            },
          }),
        }
      );
      if (!geminiRes.ok) {
        const errBody = await geminiRes.json().catch(() => null);
        logger.error("Échec de l'appel à Gemini", { status: geminiRes.status, errBody });
        res.status(502).json({ error: "Le service de lecture de photo a échoué." });
        return;
      }
      const body = await geminiRes.json();
      const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        res.status(502).json({ error: "Réponse vide du service de lecture de photo." });
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        logger.error("Réponse Gemini non JSON", { text });
        res.status(502).json({ error: "Réponse du service de lecture de photo dans un format inattendu." });
        return;
      }
      res.status(200).json(parsed);
    } catch (err) {
      logger.error("Erreur inattendue dans analyzeSessionPhoto", err);
      res.status(500).json({ error: "Erreur inattendue côté serveur." });
    }
  }
);

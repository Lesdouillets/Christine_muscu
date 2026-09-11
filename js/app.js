// Logique de l'application. Phase 1 : squelette installable + saisie manuelle
// (section 5.2 de la spec) + écran séance (section 6). L'import photo et la
// correspondance IA (phases 4 et 5 du plan) ne sont pas encore construits.

let currentSessionId = null;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateFr(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function goTo(viewName) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById("view-" + viewName).classList.add("active");
  document.querySelectorAll(".navitem").forEach((n) => n.classList.remove("sel"));
  document.querySelectorAll(`.navitem[data-nav="${viewName}"]`).forEach((n) => n.classList.add("sel"));
}

// ---------- Import de la bibliothèque publique (phase 2) ----------
// Import unique, au premier lancement, du jeu de données accepté avec
// Christine (hasaneyldrm/exercises-dataset, cf. spec section 7). Les ids
// sont préfixés "ds-" pour ne jamais entrer en collision avec un exercice
// ajouté à la main (uid() ne produit jamais ce préfixe).
async function seedPublicLibraryIfNeeded() {
  const count = await Db.countLibraryExercises();
  if (count > 0) return;
  try {
    const res = await fetch("data/exercises-library.json");
    if (!res.ok) return;
    const data = await res.json();
    const records = data.map((e) => ({
      id: "ds-" + e.id,
      name: e.name,
      type: e.type,
      bodyPart: e.bodyPart,
      equipment: e.equipment,
      target: e.target,
      instructionsFr: e.instructionsFr,
      gif: e.gif ? { kind: "link", value: e.gif } : null,
    }));
    await Db.bulkAddLibraryExercises(records);
  } catch (err) {
    // Pas de réseau au premier lancement : l'app reste utilisable, la
    // bibliothèque publique sera importée dès qu'une connexion sera là.
  }
}

// Dictionnaire de synonymes écrit à la main (à la demande de Christine, ex.
// "hip thrust" caché dans le jeu de données sous "barbell lying lifting (on
// hip)"). Couvre les mouvements les plus courants, pas l'intégralité des
// 1324 exercices - complète le renommage manuel, ne le remplace pas.
// Clé : terme courant (français ou anglais) tel que Christine tape dans la
// recherche. Valeur : fragments du nom anglais du jeu de données à associer.
const SEARCH_SYNONYMS = {
  "hip thrust": ["lying lifting (on hip)", "glute bridge", "hip thrust"],
  "pont fessier": ["glute bridge"],
  "développé couché": ["bench press"],
  "développé militaire": ["overhead press", "military press", "shoulder press"],
  "développé épaules": ["overhead press", "shoulder press"],
  "soulevé de terre": ["deadlift"],
  "traction": ["pull-up", "pulldown", "pull up"],
  "tirage": ["row", "pulldown"],
  "rowing": ["row"],
  "presse à cuisses": ["leg press"],
  "presse jambes": ["leg press"],
  "extension mollets": ["calf raise"],
  "mollets": ["calf"],
  "élévations latérales": ["lateral raise"],
  "élévation latérale": ["lateral raise"],
  "curl biceps": ["biceps curl", "curl"],
  "curl": ["curl"],
  "extension triceps": ["triceps extension", "pushdown", "skullcrusher"],
  "gainage": ["plank"],
  "planche": ["plank"],
  "fentes": ["lunge"],
  "fente": ["lunge"],
  "pompes": ["push-up", "press up"],
  "pompe": ["push-up", "press up"],
  "abdos": ["sit-up", "crunch"],
  "crunch": ["crunch"],
  "dips": ["dip"],
  "haussements d'épaules": ["shrug"],
  "shrugs": ["shrug"],
  "squat bulgare": ["single leg split squat"],
  "moulinet": ["cable crossover", "cable fly"],
  "écarté couché": ["fly", "flye"],
  "écartés": ["fly", "flye"],
};

// Retire les accents ("développé" -> "developpe") pour que la recherche
// fonctionne même si le clavier du téléphone (ou l'autocorrection) les avale -
// bug constaté en testant : "developpe couche" sans accent ne trouvait rien.
function stripAccents(str) {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Une requête correspond si le nom contient directement le texte tapé, ou si
// la requête (ou le nom) correspond à une entrée du dictionnaire ci-dessus.
// Le dictionnaire de synonymes n'est consulté qu'à partir de 3 caractères,
// sinon une requête très courte ("e", "a"...) matche presque toutes les clés
// et noie la recherche sous des résultats sans rapport.
function matchesSearch(name, rawQ) {
  if (!rawQ) return true;
  const n = stripAccents(name.toLowerCase());
  const q = stripAccents(rawQ.toLowerCase());
  if (n.includes(q)) return true;
  if (q.length < 3) return false;
  for (const key in SEARCH_SYNONYMS) {
    const k = stripAccents(key);
    if (q.includes(k) || k.includes(q)) {
      if (SEARCH_SYNONYMS[key].some((term) => n.includes(stripAccents(term)))) return true;
    }
  }
  return false;
}

function gifUrlOf(libEx) {
  if (!libEx || !libEx.gif) return null;
  return libEx.gif.value || null;
}

// ---------- Journal ----------

async function renderJournal(filterText) {
  const sessions = await Db.getAllSessions();
  const listEl = document.getElementById("session-list");
  listEl.innerHTML = "";

  let visibleSessions = sessions;
  if (filterText && filterText.trim()) {
    const q = filterText.trim().toLowerCase();
    const matches = [];
    for (const s of sessions) {
      const exs = await Db.getExerciseSessionsForSession(s.id);
      if (exs.some((e) => e.name.toLowerCase().includes(q))) matches.push(s);
    }
    visibleSessions = matches;
  }

  if (visibleSessions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = filterText
      ? "Aucune séance ne correspond à cette recherche."
      : "Aucune séance pour l'instant. Touche le bouton + pour en ajouter une.";
    listEl.appendChild(empty);
  }

  for (const s of visibleSessions) {
    const exs = await Db.getExerciseSessionsForSession(s.id);
    const card = document.createElement("div");
    card.className = "session-card";
    card.innerHTML = `
      <button class="session-card-main">
        <div class="session-top">
          <span class="session-date">${formatDateFr(s.date)}</span>
          <span class="session-meta">${exs.length} exercice${exs.length > 1 ? "s" : ""}</span>
        </div>
        <div class="session-title">${escapeHtml(s.title)}</div>
      </button>
      <button class="session-delete" title="Supprimer cette séance" aria-label="Supprimer cette séance">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>
      </button>
    `;
    card.querySelector(".session-card-main").addEventListener("click", () => openSession(s.id));
    card.querySelector(".session-delete").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Supprimer la séance « ${s.title} » du ${formatDateFr(s.date)} ? Cette action est définitive.`)) return;
      await Db.deleteSession(s.id);
      await renderJournal(document.getElementById("journal-search").value);
    });
    listEl.appendChild(card);
  }

  // stats
  const total = sessions.length;
  const now = new Date();
  const thisMonth = sessions.filter((s) => {
    const d = new Date(s.date + "T00:00:00");
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  document.getElementById("stat-total").textContent = total;
  document.getElementById("stat-month").textContent = thisMonth;
  document.getElementById("stat-record").textContent = await computeRecordWeightLabel(sessions);
}

// Record personnel (section 3 de la spec) : la charge totale la plus lourde
// jamais enregistrée, tous exercices à barre/haltères confondus.
async function computeRecordWeightLabel(sessions) {
  let best = 0;
  for (const s of sessions) {
    const exs = await Db.getExerciseSessionsForSession(s.id);
    for (const ex of exs) {
      if (ex.type !== "barre" && ex.type !== "halteres") continue;
      for (const round of ex.rounds || []) {
        const w = round.weight;
        if (!w) continue;
        const total = ex.type === "barre" ? w.bar + w.added * 2 : w.perHand * 2;
        if (total > best) best = total;
      }
    }
  }
  if (best === 0) return "—";
  const rounded = Math.round(best * 10) / 10;
  return `${rounded} kg`;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ---------- Nouvelle séance (formulaire) ----------

function openNewSessionForm() {
  document.getElementById("new-session-title").value = "Séance";
  document.getElementById("new-session-date").value = todayIso();
  document.getElementById("new-session-tours").value = 4;
  goTo("new-session");
}

function stepNewSessionTours(delta) {
  const input = document.getElementById("new-session-tours");
  const min = parseInt(input.min, 10) || 1;
  const max = parseInt(input.max, 10) || 10;
  const next = Math.min(max, Math.max(min, (parseInt(input.value, 10) || min) + delta));
  input.value = next;
}

async function createSession() {
  const title = document.getElementById("new-session-title").value.trim() || "Séance";
  const date = document.getElementById("new-session-date").value || todayIso();
  const tours = Math.max(1, parseInt(document.getElementById("new-session-tours").value, 10) || 1);
  const session = await Db.addSession({ date, title, tours });
  openSession(session.id);
}

// Recrée une nouvelle séance aujourd'hui avec les mêmes exercices qu'une
// séance existante (même titre, même nombre de tours, même ordre), mais sans
// aucun poids/ressenti enregistré - un vrai nouveau départ, pas une copie des
// anciennes valeurs. Pratique pour les routines qui reviennent (jambes, haut
// du corps...) sans tout re-chercher à chaque fois.
async function duplicateSession(sessionId) {
  const source = await Db.getSession(sessionId);
  if (!source) return;
  const sourceExs = await Db.getExerciseSessionsForSession(sessionId);
  const newSession = await Db.addSession({ date: todayIso(), title: source.title, tours: source.tours });
  for (const ex of sourceExs) {
    await Db.addExerciseSession({
      sessionId: newSession.id,
      libraryExerciseId: ex.libraryExerciseId,
      name: ex.name,
      type: ex.type,
      targetReps: ex.targetReps,
      order: ex.order,
      rounds: [],
    });
    if (ex.libraryExerciseId) await bumpLibraryUsage(ex.libraryExerciseId);
  }
  openSession(newSession.id);
}

// ---------- Écran séance ----------

async function openSession(sessionId) {
  currentSessionId = sessionId;
  const session = await Db.getSession(sessionId);
  document.getElementById("session-title-display").textContent = session.title;
  document.getElementById("session-date-display").textContent = formatDateFr(session.date);
  document.getElementById("session-tours-value").textContent = session.tours || 1;
  await renderExerciseList();
  goTo("session");
}

// Change le nombre de tours d'une séance déjà créée (visible et modifiable
// depuis l'écran de la séance, pas seulement à la création) - à la demande
// de Christine. Les tours en trop ne sont pas rendus si on en retire, mais
// rien n'est supprimé en base : remonter le nombre les fait réapparaître.
async function stepSessionTours(delta) {
  const session = await Db.getSession(currentSessionId);
  if (!session) return;
  const next = Math.min(10, Math.max(1, (session.tours || 1) + delta));
  session.tours = next;
  await Db.updateSession(session);
  document.getElementById("session-tours-value").textContent = next;
  await renderExerciseList();
}

async function renderExerciseList() {
  const session = await Db.getSession(currentSessionId);
  const exs = await Db.getExerciseSessionsForSession(currentSessionId);
  const listEl = document.getElementById("exercise-list");
  listEl.innerHTML = "";

  for (const ex of exs) {
    const last = await Db.getLastExerciseSession(ex.libraryExerciseId, currentSessionId);
    listEl.appendChild(await buildExerciseCard(session, ex, last));
  }
}

function weightLabel(type, weight) {
  if (!weight) return "—";
  if (type === "barre") return `${weight.bar} kg + 2×${weight.added} (${weight.bar + weight.added * 2} kg)`;
  if (type === "halteres") return `${weight.perHand} kg / main`;
  return "—";
}

async function buildExerciseCard(session, ex, last) {
  const item = document.createElement("div");
  item.className = "acc-item";
  item.dataset.exerciseSessionId = ex.id;

  // Le nom est capté sur l'exerciseSession au moment de l'ajout à la séance
  // et ne bouge plus tout seul ; si l'exercice a depuis été renommé dans la
  // bibliothèque, on affiche le nom à jour (comme pour l'onglet Progrès).
  const libExForName = ex.libraryExerciseId ? await Db.getLibraryExercise(ex.libraryExerciseId) : null;
  const displayName = (libExForName && libExForName.name) || ex.name;

  const head = document.createElement("button");
  head.className = "acc-head";
  head.innerHTML = `
    <div class="acc-head-main">
      <span class="acc-name">${escapeHtml(displayName)}</span>
      <span class="acc-sub">${ex.targetReps} reps · ${typeLabel(ex.type)}</span>
    </div>
    <div class="acc-right">
      ${libExForName ? `
      <button type="button" class="lib-fav-btn acc-fav-btn${libExForName.favorite ? " on" : ""}" title="Marquer comme favori" aria-label="Marquer comme favori">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="${libExForName.favorite ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
      </button>` : ""}
      <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
    </div>
  `;
  head.addEventListener("click", () => {
    const wasOpen = item.classList.contains("open");
    document.querySelectorAll(".acc-item.open").forEach((i) => i.classList.remove("open"));
    if (!wasOpen) item.classList.add("open");
  });
  // Favoris directement depuis la séance (à la demande de Christine) - agit
  // sur l'exercice de bibliothèque, comme le favori de la bibliothèque
  // elle-même : les deux se reflètent l'un l'autre.
  const favBtnInCard = head.querySelector(".acc-fav-btn");
  if (favBtnInCard && libExForName) {
    favBtnInCard.addEventListener("click", async (e) => {
      e.stopPropagation();
      libExForName.favorite = !libExForName.favorite;
      libExForName.updatedAt = Date.now();
      await Db.updateLibraryExercise(libExForName);
      favBtnInCard.classList.toggle("on", libExForName.favorite);
      favBtnInCard.querySelector("svg").setAttribute("fill", libExForName.favorite ? "currentColor" : "none");
    });
  }

  const panel = document.createElement("div");
  panel.className = "acc-panel";
  const body = document.createElement("div");
  body.className = "acc-body";

  // gif (bibliothèque publique importée en phase 2, ou gif ajouté à la main)
  const libEx = libExForName;
  const gifUrl = gifUrlOf(libEx);
  const gifRow = document.createElement("div");
  gifRow.className = "gif-row";
  if (gifUrl) {
    gifRow.innerHTML = `
      <div class="gif-thumb"><img src="${gifUrl}" alt="${escapeHtml(displayName)}" loading="lazy"></div>
      <div class="gif-meta"><span class="t">${escapeHtml(libEx.target || libEx.bodyPart || "")}</span></div>
    `;
  } else {
    gifRow.innerHTML = `
      <div class="gif-thumb"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>
      <div class="gif-meta"><span class="t">pas de démonstration pour cet exercice</span></div>
    `;
  }
  body.appendChild(gifRow);

  // Note personnelle sur l'exercice, modifiable depuis la séance ou la
  // bibliothèque (à la demande de Christine) - stockée sur l'exercice de
  // bibliothèque, donc partagée entre les deux vues.
  if (libExForName) {
    const noteWrap = document.createElement("div");
    noteWrap.className = "exo-note";
    noteWrap.innerHTML = `
      <span class="field-label">Note</span>
      <textarea class="exo-note-input" rows="2" placeholder="Une info à te rappeler...">${escapeHtml(libExForName.note || "")}</textarea>
    `;
    noteWrap.querySelector("textarea").addEventListener("click", (e) => e.stopPropagation());
    noteWrap.querySelector("textarea").addEventListener("change", async (e) => {
      libExForName.note = e.target.value;
      libExForName.updatedAt = Date.now();
      await Db.updateLibraryExercise(libExForName);
    });
    body.appendChild(noteWrap);
  }

  // historique + suggestion (section 6 de la spec : "noté trop léger → essaie
  // 2×15 aujourd'hui")
  if (last) {
    const lastRoundWeight = roundWeight(last, 0);
    const lastRoundFeeling = roundFeeling(last, 0);
    const lastWeightTxt = weightLabel(ex.type, lastRoundWeight);
    const lastFeeling = feelingLabel(lastRoundFeeling);
    const suggestion = suggestNextWeight(ex.type, lastRoundWeight, lastRoundFeeling);
    const histo = document.createElement("div");
    histo.className = "history-line";
    histo.innerHTML = `Dernière fois - <b>${lastWeightTxt}</b>${lastFeeling ? `, noté « ${lastFeeling} »` : ""}${suggestion ? ` → <b>${suggestion}</b>` : ""}.`;
    body.appendChild(histo);
  }

  // répétitions cible
  const repsStepper = document.createElement("div");
  repsStepper.className = "reps-stepper";
  repsStepper.innerHTML = `
    <span class="field-label">Répétitions par tour</span>
    <div class="stepper-ctrl">
      <button data-step="-1">–</button>
      <span class="num">${ex.targetReps}</span>
      <button data-step="1">+</button>
    </div>
  `;
  repsStepper.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      ex.targetReps = Math.max(1, ex.targetReps + parseInt(btn.dataset.step, 10));
      await Db.updateExerciseSession(ex);
      await renderExerciseList();
      reopenCard(ex.id);
    });
  });
  body.appendChild(repsStepper);

  // tours
  const roundsWrap = document.createElement("div");
  roundsWrap.className = "rounds-wrap";
  roundsWrap.appendChild(buildRoundFull(session, ex, 0));
  if (session.tours > 1) {
    const compactWrap = document.createElement("div");
    compactWrap.className = "rounds-compact-wrap";
    for (let r = 1; r < session.tours; r++) {
      compactWrap.appendChild(buildRoundCompact(session, ex, r));
    }
    roundsWrap.appendChild(compactWrap);
  }
  body.appendChild(roundsWrap);

  // Changer d'exercice / supprimer cet exercice de la seance - a la demande
  // de Christine ("pouvoir supprimer ou modifier un exo mis dans une
  // seance"). "Modifier" = remplacer par un autre exercice de la
  // bibliotheque (le nombre de repetitions, lui, se change deja juste
  // au-dessus via le stepper "Repetitions par tour").
  const actionsRow = document.createElement("div");
  actionsRow.className = "exo-actions-row";
  actionsRow.innerHTML = `
    <button type="button" class="exo-action-btn" data-action="swap">changer d'exercice</button>
    <button type="button" class="exo-action-btn exo-action-danger" data-action="remove">supprimer</button>
  `;
  actionsRow.querySelector('[data-action="swap"]').addEventListener("click", (e) => {
    e.stopPropagation();
    openExerciseSwapModal(ex);
  });
  actionsRow.querySelector('[data-action="remove"]').addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!confirm(`Supprimer « ${displayName} » de cette séance ? Cette action est définitive.`)) return;
    await Db.deleteExerciseSession(ex.id);
    await renderExerciseList();
  });
  body.appendChild(actionsRow);

  panel.appendChild(body);
  item.appendChild(head);
  item.appendChild(panel);
  return item;
}

function typeLabel(type) {
  return { barre: "barre", halteres: "haltères", poids_du_corps: "poids du corps", elastique: "élastique", inconnu: "à classer" }[type] || type;
}
// Types sans charge chiffrée à saisir tour par tour (juste le ressenti) -
// l'élastique s'ajoute au poids du corps à la demande de Christine : la
// résistance d'une bande n'est pas un poids en kg qu'on peut suivre pareil.
function isWeightlessType(type) {
  return type === "poids_du_corps" || type === "elastique";
}
function feelingLabel(f) {
  return { light: "trop léger", good: "bien", heavy: "trop lourd" }[f] || "";
}
// Suggestion simple (phase 6 du plan) : à partir du poids et du ressenti du
// dernier passage, propose une charge pour aujourd'hui. Ne se prononce pas
// si le dernier ressenti était "bien", ou si aucun poids n'a été noté.
// 0 permet de suggerer "la barre seule" (sans poids ajoute) quand on redescend
// depuis 2x5 - a la demande de Christine.
const WEIGHT_STEPS = [0, 5, 10, 15, 20];
function suggestNextWeight(type, weight, feeling) {
  if (!feeling || feeling === "good") return null;
  if (type === "barre") {
    if (!weight) return null;
    const idx = WEIGHT_STEPS.indexOf(weight.added);
    if (feeling === "light") {
      const next = idx >= 0 && idx < WEIGHT_STEPS.length - 1 ? WEIGHT_STEPS[idx + 1] : null;
      return next ? `essaie 2×${next} aujourd'hui` : `essaie une charge libre plus lourde aujourd'hui`;
    }
    // idx > 0 (et non "prev" tronque falsy) : 0 est une valeur valide, pas
    // une absence de valeur - un bug ici renverrait "allège encore" au lieu
    // de proposer "la barre seule" en repassant de 2x5 a 0.
    const prev = idx > 0 ? WEIGHT_STEPS[idx - 1] : null;
    if (prev === null) return "allège encore aujourd'hui";
    return prev === 0 ? "essaie la barre seule aujourd'hui" : `essaie 2×${prev} aujourd'hui`;
  }
  if (type === "halteres") {
    if (!weight) return null;
    const idx = WEIGHT_STEPS.indexOf(weight.perHand);
    if (feeling === "light") {
      const next = idx >= 0 && idx < WEIGHT_STEPS.length - 1 ? WEIGHT_STEPS[idx + 1] : null;
      return next ? `essaie ${next} kg par main aujourd'hui` : `essaie une charge libre plus lourde aujourd'hui`;
    }
    const prev = idx > 0 ? WEIGHT_STEPS[idx - 1] : null;
    return prev !== null ? `essaie ${prev} kg par main aujourd'hui` : `allège encore aujourd'hui`;
  }
  if (isWeightlessType(type)) {
    return feeling === "light" ? "essaie plus de répétitions aujourd'hui" : "réduis les répétitions si besoin aujourd'hui";
  }
  return null;
}

function roundWeight(ex, i) {
  return (ex.rounds && ex.rounds[i] && ex.rounds[i].weight) || null;
}
function roundFeeling(ex, i) {
  return (ex.rounds && ex.rounds[i] && ex.rounds[i].feeling) || null;
}

// Si un tour n'a pas de poids saisi, on considère que c'est le même que le
// dernier tour renseigné avant lui (à la demande de Christine) - pas
// forcément le tour juste avant : remonte jusqu'au premier tour qui a un
// poids. Avant ce correctif, seuls le tour precedent et le tout premier
// tour etaient consultes, donc un 4e tour vide "sautait" le poids du 2e
// tour si le 3e etait lui aussi vide.
function lastKnownWeight(ex, beforeIndex) {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    const w = roundWeight(ex, i);
    if (w) return w;
  }
  return null;
}

async function saveRound(ex, index, patch) {
  ex.rounds = ex.rounds || [];
  ex.rounds[index] = { ...(ex.rounds[index] || { round: index + 1 }), ...patch };
  await Db.updateExerciseSession(ex);
}

function buildFeelRow(ex, index, compact) {
  const row = document.createElement("div");
  row.className = "feel-row" + (compact ? " compact-feel" : "");
  const opts = [["light", "trop léger", compact ? "léger" : "trop léger"], ["good", "bien", "bien"], ["heavy", "trop lourd", compact ? "lourd" : "trop lourd"]];
  const current = roundFeeling(ex, index);
  for (const [value, , label] of opts) {
    const btn = document.createElement("button");
    btn.className = "feel-btn" + (current === value ? " sel-" + (value === "light" ? "light" : value === "good" ? "good" : "warn") : "");
    btn.textContent = label;
    btn.addEventListener("click", async () => {
      await saveRound(ex, index, { feeling: value });
      row.querySelectorAll(".feel-btn").forEach((b) => b.className = "feel-btn" + (compact ? " compact-feel" : ""));
      btn.classList.add("sel-" + (value === "light" ? "light" : value === "good" ? "good" : "warn"));
    });
    row.appendChild(btn);
  }
  return row;
}

function buildRoundFull(session, ex, index) {
  const row = document.createElement("div");
  row.className = "round-row";
  const label = document.createElement("div");
  label.className = "round-label";
  label.textContent = "Tour 1";
  row.appendChild(label);

  if (isWeightlessType(ex.type)) {
    const note = document.createElement("div");
    note.className = "bodyweight-note";
    note.textContent = ex.type === "elastique" ? "Élastique - pas de charge à saisir." : "Poids du corps - pas de charge à saisir.";
    row.appendChild(note);
  } else {
    const wb = document.createElement("div");
    wb.className = "weight-block";
    const w = roundWeight(ex, index) || (ex.type === "barre" ? { bar: 15, added: 5 } : { perHand: 5 });

    if (ex.type === "barre") {
      wb.innerHTML = `
        <div class="field-label">Barre utilisée</div>
        <div class="seg" data-role="bar">
          <button data-val="15" class="${w.bar === 15 ? "sel" : ""}">15 kg</button>
          <button data-val="20" class="${w.bar === 20 ? "sel" : ""}">20 kg</button>
        </div>
        <div class="field-label">Poids ajouté (par côté)</div>
        <div class="seg" data-role="added">
          <button data-val="0" class="${w.added === 0 ? "sel" : ""}">0</button>
          <button data-val="5" class="${w.added === 5 ? "sel" : ""}">2×5</button>
          <button data-val="10" class="${w.added === 10 ? "sel" : ""}">2×10</button>
          <button data-val="15" class="${w.added === 15 ? "sel" : ""}">2×15</button>
          <button data-val="20" class="${w.added === 20 ? "sel" : ""}">2×20</button>
          <button data-val="libre" class="libre-btn">libre</button>
        </div>
        <div class="libre-row"><span>2 ×</span><input type="number" step="0.5" placeholder="ex. 12,5"><span>kg</span></div>
        <div class="weight-total"></div>
      `;
    } else {
      wb.innerHTML = `
        <div class="field-label">Haltère (par main)</div>
        <div class="seg" data-role="perHand">
          <button data-val="5" class="${w.perHand === 5 ? "sel" : ""}">5 kg</button>
          <button data-val="10" class="${w.perHand === 10 ? "sel" : ""}">10 kg</button>
          <button data-val="15" class="${w.perHand === 15 ? "sel" : ""}">15 kg</button>
          <button data-val="20" class="${w.perHand === 20 ? "sel" : ""}">20 kg</button>
          <button data-val="libre" class="libre-btn">libre</button>
        </div>
        <div class="libre-row"><span>par main :</span><input type="number" step="0.5" placeholder="ex. 17,5"><span>kg</span></div>
      `;
    }
    wireWeightBlock(wb, ex, index, w);
    row.appendChild(wb);
  }

  row.appendChild(buildFeelRow(ex, index, false));
  return row;
}

function wireWeightBlock(wb, ex, index, currentWeight) {
  const updateTotal = (w) => {
    const totalEl = wb.querySelector(".weight-total");
    if (totalEl && ex.type === "barre") {
      totalEl.textContent = `total : ${w.bar} kg + 2×${w.added} kg = ${w.bar + w.added * 2} kg`;
    }
  };
  updateTotal(currentWeight);

  wb.querySelectorAll(".seg").forEach((seg) => {
    seg.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", async () => {
        seg.querySelectorAll("button").forEach((b) => b.classList.remove("sel"));
        const libreRow = seg.parentElement.querySelector(".libre-row");
        if (btn.dataset.val === "libre") {
          btn.classList.add("sel");
          if (libreRow) libreRow.classList.add("open");
          return;
        }
        if (libreRow) libreRow.classList.remove("open");
        btn.classList.add("sel");
        const role = seg.dataset.role;
        const w = { ...(roundWeight(ex, index) || (ex.type === "barre" ? { bar: 15, added: 5 } : { perHand: 5 })) };
        w[role] = parseFloat(btn.dataset.val);
        await saveRound(ex, index, { weight: w });
        updateTotal(w);
        // Les tours suivants (non renseignés) affichent "comme avant" en
        // héritant de ce poids - il faut reconstruire leurs pastilles pour
        // que ça se voie tout de suite, sans attendre de refermer/rouvrir
        // la carte.
        await refreshCompactRoundsFor(ex.id);
      });
    });
  });

  wb.querySelectorAll(".libre-row input").forEach((input) => {
    input.addEventListener("change", async () => {
      const seg = input.closest(".weight-block").querySelector(".seg[data-role='added'], .seg[data-role='perHand']");
      const role = seg.dataset.role;
      const w = { ...(roundWeight(ex, index) || (ex.type === "barre" ? { bar: 15, added: 5 } : { perHand: 5 })) };
      w[role] = parseFloat(input.value) || 0;
      await saveRound(ex, index, { weight: w });
      updateTotal(w);
      await refreshCompactRoundsFor(ex.id);
    });
  });
}

// Reconstruit uniquement les pastilles de tours compacts (2e tour et
// suivants) d'une carte d'exercice donnée, sans tout re-render/refermer la
// carte comme le ferait renderExerciseList() - plus léger et ça ne fait pas
// "sauter" l'écran pendant la saisie du 1er tour.
async function refreshCompactRoundsFor(exerciseSessionId) {
  const item = document.querySelector(`.acc-item[data-exercise-session-id="${exerciseSessionId}"]`);
  if (!item) return;
  const compactWrap = item.querySelector(".rounds-compact-wrap");
  if (!compactWrap) return;
  const session = await Db.getSession(currentSessionId);
  const all = await Db.getExerciseSessionsForSession(currentSessionId);
  const ex = all.find((e) => e.id === exerciseSessionId);
  if (!ex || !session) return;
  compactWrap.innerHTML = "";
  for (let r = 1; r < session.tours; r++) {
    compactWrap.appendChild(buildRoundCompact(session, ex, r));
  }
}

function buildRoundCompact(session, ex, index) {
  const row = document.createElement("div");
  row.className = "round-compact";
  const top = document.createElement("div");
  top.className = "rc-top";
  const label = document.createElement("span");
  label.className = "rc-label";
  label.textContent = `Tour ${index + 1}`;
  top.appendChild(label);

  if (!isWeightlessType(ex.type)) {
    const chip = document.createElement("button");
    chip.className = "rc-weight";
    const explicitWeight = roundWeight(ex, index);
    const w = explicitWeight || lastKnownWeight(ex, index);
    chip.textContent = w
      ? weightLabel(ex.type, w) + (explicitWeight ? "" : " (comme avant)") + " ✎"
      : "définir le poids ✎";
    chip.addEventListener("click", async () => {
      const current = roundWeight(ex, index) || lastKnownWeight(ex, index);
      const promptVal = prompt("Nouveau poids total (kg) pour ce tour :", current ? (ex.type === "barre" ? current.bar + current.added * 2 : current.perHand) : "");
      if (promptVal === null) return;
      const val = parseFloat(promptVal);
      if (isNaN(val)) return;
      let w2;
      if (ex.type === "barre") {
        const bar = current ? current.bar : 15;
        w2 = { bar, added: Math.max(0, (val - bar) / 2) };
      } else {
        w2 = { perHand: val };
      }
      await saveRound(ex, index, { weight: w2 });
      chip.textContent = weightLabel(ex.type, w2) + " ✎";
      // Les tours APRES celui-ci peuvent hériter de ce nouveau poids s'ils
      // ne sont pas eux-mêmes renseignés - il faut les reconstruire aussi.
      await refreshCompactRoundsFor(ex.id);
    });
    top.appendChild(chip);
  }
  row.appendChild(top);
  row.appendChild(buildFeelRow(ex, index, true));
  return row;
}

function reopenCard(exerciseSessionId) {
  const item = document.querySelector(`.acc-item[data-exercise-session-id="${exerciseSessionId}"]`);
  if (item) item.classList.add("open");
}

// ---------- Bibliothèque ----------

// Regroupement des muscles ciblés (champ "target" du jeu de données) en
// catégories simples pour le filtre de la bibliothèque, à la demande de
// Christine ("classer les gifs par catégorie : fesses, dos, bras...").
const TARGET_CATEGORIES = [
  { key: "fessiers", label: "Fessiers", targets: ["glutes"] },
  { key: "dos", label: "Dos", targets: ["upper back", "lats", "spine", "traps", "serratus anterior", "levator scapulae"] },
  { key: "bras", label: "Bras", targets: ["biceps", "triceps", "forearms"] },
  { key: "pectoraux", label: "Pectoraux", targets: ["pectorals"] },
  { key: "epaules", label: "Épaules", targets: ["delts"] },
  { key: "abdos", label: "Abdos", targets: ["abs"] },
  { key: "jambes", label: "Jambes", targets: ["quads", "hamstrings", "calves", "adductors", "abductors"] },
  { key: "cardio", label: "Cardio", targets: ["cardiovascular system"] },
];
const TARGET_TO_CATEGORY = {};
for (const cat of TARGET_CATEGORIES) {
  for (const t of cat.targets) TARGET_TO_CATEGORY[t] = cat.key;
}
function categoryOf(ex) {
  return TARGET_TO_CATEGORY[(ex.target || "").toLowerCase()] || "autres";
}

// Deuxième filtre, par matériel (à la demande de Christine, combinable avec
// le filtre par muscle et la recherche texte).
// "Élastique" est place juste apres "Barre" (avant Câble/Machine) pour rester
// visible sans avoir a faire defiler la rangee sur telephone - a la demande
// de Christine, qui ne le voyait pas alors qu'il existait deja plus loin
// dans la liste.
const EQUIPMENT_CATEGORIES = [
  { key: "poids_du_corps", label: "Poids du corps", equipment: ["body weight", "assisted"] },
  { key: "halteres", label: "Haltères", equipment: ["dumbbell"] },
  { key: "barre", label: "Barre", equipment: ["barbell", "ez barbell", "olympic barbell", "trap bar"] },
  { key: "elastique", label: "Élastique", equipment: ["band", "resistance band"] },
  { key: "cable", label: "Câble", equipment: ["cable"] },
  { key: "machine", label: "Machine", equipment: ["leverage machine", "smith machine", "sled machine", "stepmill machine", "elliptical machine", "upper body ergometer", "skierg machine", "stationary bike"] },
  { key: "kettlebell", label: "Kettlebell", equipment: ["kettlebell"] },
];
const EQUIPMENT_TO_CATEGORY = {};
for (const cat of EQUIPMENT_CATEGORIES) {
  for (const e of cat.equipment) EQUIPMENT_TO_CATEGORY[e] = cat.key;
}
function equipmentCategoryOf(ex) {
  return EQUIPMENT_TO_CATEGORY[(ex.equipment || "").toLowerCase()] || "autre";
}

let libraryCategory = null; // null = "Tout" (filtre par muscle)
let libraryEquipment = null; // null = "Tout" (filtre par matériel)
let libraryQuickFilter = null; // null = "Tout" | "favorites" | "used"

function renderLibraryCategoryChips() {
  buildChipRowCustom(
    "library-categories",
    [{ key: null, label: "Tout" }, ...TARGET_CATEGORIES, { key: "autres", label: "Autres" }],
    () => libraryCategory,
    (key) => { libraryCategory = key; renderLibrary(document.getElementById("library-search").value); }
  );
  buildChipRowCustom(
    "library-equipment",
    [{ key: null, label: "Tout matériel" }, ...EQUIPMENT_CATEGORIES, { key: "autre", label: "Autre" }],
    () => libraryEquipment,
    (key) => { libraryEquipment = key; renderLibrary(document.getElementById("library-search").value); }
  );
  buildChipRowCustom(
    "library-quickfilter",
    [{ key: null, label: "Tout" }, { key: "favorites", label: "★ Favoris" }, { key: "used", label: "Les plus utilisés" }],
    () => libraryQuickFilter,
    (key) => { libraryQuickFilter = key; renderLibrary(document.getElementById("library-search").value); }
  );
}

async function renderLibrary(filterText) {
  renderLibraryCategoryChips();
  const gridEl = document.getElementById("library-grid");
  const statusEl = document.getElementById("lib-status");
  const count = await Db.countLibraryExercises();
  if (count === 0) {
    statusEl.textContent = "Import de la bibliothèque en cours (nécessite une connexion la première fois)…";
  }

  const q = (filterText || "").trim().toLowerCase();
  let results = (await Db.getAllLibraryExercises()).filter((ex) => matchesSearch(ex.name, q));
  if (libraryCategory) {
    results = results.filter((ex) => categoryOf(ex) === libraryCategory);
  }
  if (libraryEquipment) {
    results = results.filter((ex) => equipmentCategoryOf(ex) === libraryEquipment);
  }
  // Ordre alphabétique par défaut (à la demande de Christine) - sauf pour
  // le filtre "les plus utilisés" qui garde son propre tri par popularité.
  results.sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
  if (libraryQuickFilter === "favorites") {
    results = results.filter((ex) => ex.favorite);
  } else if (libraryQuickFilter === "used") {
    results = results.filter((ex) => (ex.usageCount || 0) > 0).sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
  }
  gridEl.innerHTML = "";

  if (results.length === 0 && count > 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Aucun exercice ne correspond à cette recherche.";
    gridEl.appendChild(empty);
    return;
  }

  // Pas de plafond artificiel ici : avec un plafond bas (120 avant), un
  // exercice renommé ou une catégorie un peu grande (fessiers = 144,
  // pectoraux = 158, abdos = 169...) disparaissait silencieusement de la
  // grille - bug constaté en testant. La recherche/les filtres suffisent à
  // réduire la liste ; le statut ci-dessous indique toujours combien
  // d'exercices correspondent.
  if (count > 0) {
    statusEl.textContent = `${results.length} exercice${results.length > 1 ? "s" : ""}`;
  }
  for (const ex of results) {
    const gifUrl = gifUrlOf(ex);
    const usage = ex.usageCount || 0;
    const item = document.createElement("div");
    item.className = "lib-item";
    item.innerHTML = `
      <button class="lib-fav-btn${ex.favorite ? " on" : ""}" title="Marquer comme favori" aria-label="Marquer comme favori">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="${ex.favorite ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
      </button>
      <div class="lib-item-thumb">${gifUrl ? `<img src="${gifUrl}" alt="" loading="lazy">` : ""}</div>
      <div class="lib-item-name">${escapeHtml(ex.name)}</div>
      <div class="lib-item-sub">${escapeHtml(ex.equipment || typeLabel(ex.type))}${usage > 0 ? `<div class="lib-item-usage">utilisé ${usage}×</div>` : ""}</div>
    `;
    item.addEventListener("click", () => openLibraryDetail(ex));
    item.querySelector(".lib-fav-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      ex.favorite = !ex.favorite;
      ex.updatedAt = Date.now();
      await Db.updateLibraryExercise(ex);
      renderLibrary(document.getElementById("library-search").value);
    });
    gridEl.appendChild(item);
  }
}

// Incrémente le compteur d'utilisation d'un exercice de bibliothèque - appelé
// à chaque fois qu'il est ajouté à une séance (voir addExerciseToSession).
async function bumpLibraryUsage(libraryExerciseId) {
  const libEx = await Db.getLibraryExercise(libraryExerciseId);
  if (!libEx) return;
  libEx.usageCount = (libEx.usageCount || 0) + 1;
  await Db.updateLibraryExercise(libEx);
}

function openLibraryDetail(ex) {
  const gifUrl = gifUrlOf(ex);
  document.getElementById("lib-detail-gif").innerHTML = gifUrl
    ? `<img src="${gifUrl}" alt="${escapeHtml(ex.name)}">`
    : `<div class="lib-detail-noGif">pas de démonstration pour cet exercice</div>`;
  document.getElementById("lib-detail-name").textContent = ex.name;
  const usage = ex.usageCount || 0;
  document.getElementById("lib-detail-meta").textContent = [ex.equipment, ex.target, ex.bodyPart, usage > 0 ? `utilisé ${usage}×` : null]
    .filter(Boolean)
    .join(" · ") || typeLabel(ex.type);
  document.getElementById("lib-detail-instr").textContent = ex.instructionsFr || "";
  // Note personnelle (à la demande de Christine) : modifiable ici comme
  // depuis une séance, mais elle ne sert vraiment que pendant les séances -
  // pas affichée dans la grille de la bibliothèque.
  const noteInput = document.getElementById("lib-detail-note-input");
  noteInput.value = ex.note || "";
  noteInput.onchange = async () => {
    ex.note = noteInput.value;
    ex.updatedAt = Date.now();
    await Db.updateLibraryExercise(ex);
  };
  document.getElementById("lib-detail-rename-field").hidden = true;
  document.getElementById("lib-detail-rename-btn").onclick = () => {
    document.getElementById("lib-detail-rename-input").value = ex.name;
    document.getElementById("lib-detail-rename-field").hidden = false;
    document.getElementById("lib-detail-rename-input").focus();
  };
  document.getElementById("lib-detail-rename-cancel").onclick = () => {
    document.getElementById("lib-detail-rename-field").hidden = true;
  };
  document.getElementById("lib-detail-rename-save").onclick = async () => {
    const newName = document.getElementById("lib-detail-rename-input").value.trim();
    if (!newName) return;
    ex.name = newName;
    ex.updatedAt = Date.now();
    await Db.updateLibraryExercise(ex);
    document.getElementById("lib-detail-name").textContent = ex.name;
    document.getElementById("lib-detail-rename-field").hidden = true;
    renderLibrary(document.getElementById("library-search").value);
  };
  const favBtn = document.getElementById("lib-detail-fav-btn");
  favBtn.textContent = ex.favorite ? "★ Dans les favoris" : "★ Ajouter aux favoris";
  favBtn.classList.toggle("on", !!ex.favorite);
  favBtn.onclick = async () => {
    ex.favorite = !ex.favorite;
    ex.updatedAt = Date.now();
    await Db.updateLibraryExercise(ex);
    favBtn.textContent = ex.favorite ? "★ Dans les favoris" : "★ Ajouter aux favoris";
    favBtn.classList.toggle("on", !!ex.favorite);
    renderLibrary(document.getElementById("library-search").value);
  };
  // Suppression de la bibliothèque (à la demande de Christine, pour nettoyer
  // les exercices créés en double ou par erreur). L'historique des séances
  // déjà faites avec cet exercice n'est pas touché - voir Db.deleteLibraryExercise.
  document.getElementById("lib-detail-delete-btn").onclick = async () => {
    if (!confirm(`Supprimer « ${ex.name} » de la bibliothèque ? Les séances passées qui l'utilisent ne seront pas modifiées, mais tu ne pourras plus le retrouver ni le réutiliser tel quel.`)) return;
    await Db.deleteLibraryExercise(ex.id);
    closeLibraryDetail();
    await renderLibrary(document.getElementById("library-search").value);
  };
  document.getElementById("library-detail-modal").classList.add("open");
}
function closeLibraryDetail() {
  document.getElementById("library-detail-modal").classList.remove("open");
}

// ---------- Ajouter un exercice à la bibliothèque (hors séance) ----------

let libNewGifKind = "link";
let libNewGifFileDataUrl = null;

function openLibraryAddModal() {
  document.getElementById("lib-new-name").value = "";
  document.getElementById("lib-new-type").value = "barre";
  document.getElementById("lib-new-gif-link").value = "";
  document.getElementById("lib-new-gif-file").value = "";
  libNewGifKind = "link";
  libNewGifFileDataUrl = null;
  document.querySelectorAll("#lib-new-gif-kind button").forEach((b) => b.classList.toggle("sel", b.dataset.val === "link"));
  document.getElementById("lib-new-gif-link-field").hidden = false;
  document.getElementById("lib-new-gif-file-field").hidden = true;
  document.getElementById("library-add-modal").classList.add("open");
}
function closeLibraryAddModal() {
  document.getElementById("library-add-modal").classList.remove("open");
}

async function confirmAddLibraryExercise() {
  const name = document.getElementById("lib-new-name").value.trim();
  if (!name) {
    alert("Donne un nom à l'exercice.");
    return;
  }
  const type = document.getElementById("lib-new-type").value;
  let gif = null;
  if (libNewGifKind === "link") {
    const url = document.getElementById("lib-new-gif-link").value.trim();
    if (url) gif = { kind: "link", value: url };
  } else if (libNewGifKind === "file" && libNewGifFileDataUrl) {
    gif = { kind: "file", value: libNewGifFileDataUrl };
  }
  try {
    // Favori par défaut ici aussi, pour la même raison que côté séance : sinon
    // l'exercice n'apparaît plus dans la modale d'ajout (filtrée sur les
    // favoris par défaut) tant qu'on ne l'a pas favorisé à la main.
    await Db.addLibraryExercise({ name, type, gif, bodyPart: "", equipment: "", target: "", instructionsFr: "", favorite: true });
    closeLibraryAddModal();
    await renderLibrary(document.getElementById("library-search").value);
  } catch (err) {
    console.error("[carnet-muscu] échec de l'ajout à la bibliothèque :", err);
    alert("Impossible d'enregistrer cet exercice (" + (err && err.message ? err.message : "erreur inconnue") + "). Si tu avais choisi une photo/gif volumineux, réessaie avec un lien ou sans gif.");
  }
}

// ---------- Ajouter un exercice à une séance ----------

let newExerciseReps = 10;
let newExerciseName = "";
let modalCategory = null;
let modalEquipment = null;
let modalFavoritesOnly = false;
// Gif choisi lors de la création d'un tout nouvel exercice depuis une séance
// (à la demande de Christine, comme pour l'ajout depuis la bibliothèque).
let newExerciseGifKind = "link";
let newExerciseGifFileDataUrl = null;
// Exercice de bibliothèque déjà existant en cours de sélection (on passe par
// l'étape "répétitions" avant de l'ajouter, comme pour un exercice tout
// neuf) - null quand on crée un exercice qui n'existe pas encore.
let pendingExistingLibEx = null;
// Id de l'exerciseSession a REMPLACER (mode "changer d'exercice" ouvert
// depuis une carte de la séance) - null quand la modale sert a ajouter un
// nouvel exercice à la séance (comportement normal).
let swapTargetExerciseSessionId = null;

function buildModalChips() {
  buildChipRowCustom(
    "modal-quickfilter",
    [{ key: false, label: "Tout" }, { key: true, label: "★ Favoris" }],
    () => modalFavoritesOnly,
    (key) => { modalFavoritesOnly = key; searchExercisesInModal(document.getElementById("exercise-search-input").value); }
  );
  buildChipRowCustom(
    "modal-categories",
    [{ key: null, label: "Tout" }, ...TARGET_CATEGORIES, { key: "autres", label: "Autres" }],
    () => modalCategory,
    (key) => { modalCategory = key; searchExercisesInModal(document.getElementById("exercise-search-input").value); }
  );
  buildChipRowCustom(
    "modal-equipment",
    [{ key: null, label: "Tout matériel" }, ...EQUIPMENT_CATEGORIES, { key: "autre", label: "Autre" }],
    () => modalEquipment,
    (key) => { modalEquipment = key; searchExercisesInModal(document.getElementById("exercise-search-input").value); }
  );
}

// Comme buildChipRow, mais l'action de sélection ne relance pas renderLibrary
// (utilisée à la fois par la bibliothèque et par la modale d'ajout).
function buildChipRowCustom(rowId, chips, getSelected, onSelect) {
  const row = document.getElementById(rowId);
  if (row.dataset.built) return;
  row.dataset.built = "1";
  for (const c of chips) {
    const btn = document.createElement("button");
    btn.className = "lib-cat-chip" + (getSelected() === c.key ? " sel" : "");
    btn.textContent = c.label;
    btn.addEventListener("click", () => {
      onSelect(c.key);
      row.querySelectorAll(".lib-cat-chip").forEach((b) => b.classList.remove("sel"));
      btn.classList.add("sel");
    });
    row.appendChild(btn);
  }
}

function openExerciseModal() {
  document.getElementById("exercise-search-input").value = "";
  document.getElementById("new-exercise-form").hidden = true;
  newExerciseReps = 10;
  newExerciseName = "";
  pendingExistingLibEx = null;
  swapTargetExerciseSessionId = null;
  document.getElementById("exercise-modal-title").textContent = "Ajouter un exercice";
  document.getElementById("confirm-add-exercise-verb").textContent = "Ajouter";
  modalCategory = null;
  modalEquipment = null;
  // Par défaut, on filtre sur les favoris à l'ouverture (à la demande de
  // Christine) - on ajoute un exercice depuis une séance le plus souvent
  // parmi les exos qu'on fait déjà régulièrement.
  modalFavoritesOnly = true;
  buildModalChips();
  document.getElementById("modal-quickfilter-group").hidden = false;
  document.getElementById("modal-categories-group").hidden = false;
  document.getElementById("modal-equipment-group").hidden = false;
  document.getElementById("modal-quickfilter").querySelectorAll(".lib-cat-chip").forEach((b) => b.classList.toggle("sel", b.textContent === "★ Favoris"));
  document.getElementById("modal-categories").querySelectorAll(".lib-cat-chip").forEach((b) => b.classList.toggle("sel", b.textContent === "Tout"));
  document.getElementById("modal-equipment").querySelectorAll(".lib-cat-chip").forEach((b) => b.classList.toggle("sel", b.textContent === "Tout matériel"));
  document.getElementById("new-exercise-reps-value").textContent = "10";
  document.getElementById("exercise-modal").classList.add("open");
  // Pas de focus auto sur le champ : sur téléphone ça ouvre le clavier tout
  // de suite et écrase les filtres/résultats avant même d'avoir tapé quoi
  // que ce soit. On laisse Christine ouvrir le clavier elle-même en touchant
  // le champ quand elle veut chercher par texte.
  searchExercisesInModal("");
}
function closeExerciseModal() {
  document.getElementById("exercise-modal").classList.remove("open");
  swapTargetExerciseSessionId = null;
}

// Ouvre la meme modale de recherche/creation d'exercice, mais en mode
// "remplacement" : au lieu d'ajouter un nouvel exercice a la seance, on met
// a jour l'exercice existant (ex.libraryExerciseId/name/type) - les tours
// deja saisis sont remis a zero puisqu'ils concernaient un autre exercice.
function openExerciseSwapModal(ex) {
  openExerciseModal();
  swapTargetExerciseSessionId = ex.id;
  document.getElementById("exercise-modal-title").textContent = "Changer d'exercice";
}

async function searchExercisesInModal(query) {
  const rawQuery = query.trim();
  const q = rawQuery.toLowerCase();
  document.getElementById("new-exercise-form").hidden = true;
  pendingExistingLibEx = null;
  let results = (await Db.getAllLibraryExercises()).filter((ex) => matchesSearch(ex.name, q));
  if (modalCategory) results = results.filter((ex) => categoryOf(ex) === modalCategory);
  if (modalEquipment) results = results.filter((ex) => equipmentCategoryOf(ex) === modalEquipment);
  if (modalFavoritesOnly) results = results.filter((ex) => ex.favorite);
  // Ordre alphabétique par défaut (à la demande de Christine), comme dans
  // la bibliothèque.
  results.sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
  // Pendant la saisie, on cache les rangées de filtres pour laisser toute la
  // place aux résultats - sur téléphone le clavier prend déjà la moitié de
  // l'écran, inutile de rogner encore plus l'espace visible.
  const hideFilters = rawQuery.length > 0;
  document.getElementById("modal-quickfilter-group").hidden = hideFilters;
  document.getElementById("modal-categories-group").hidden = hideFilters;
  document.getElementById("modal-equipment-group").hidden = hideFilters;
  const resultsEl = document.getElementById("exercise-search-results");
  resultsEl.innerHTML = "";

  for (const r of results.slice(0, 8)) {
    const gifUrl = gifUrlOf(r);
    const div = document.createElement("div");
    div.className = "result-item result-item-withgif";
    div.innerHTML = `${gifUrl ? `<img src="${gifUrl}" alt="" loading="lazy">` : ""}<span>${escapeHtml(r.name)} (${typeLabel(r.type)})</span>`;
    div.addEventListener("click", () => openReprsStepForExisting(r));
    resultsEl.appendChild(div);
  }

  const exactMatch = results.some((r) => r.name.toLowerCase() === q);
  if (rawQuery && !exactMatch) {
    const addNew = document.createElement("div");
    addNew.className = "result-item result-item-new";
    addNew.textContent = `+ ajouter « ${rawQuery} » comme nouvel exercice`;
    addNew.addEventListener("click", () => openNewExerciseForm(rawQuery));
    resultsEl.appendChild(addNew);
  }
}

function openNewExerciseForm(name) {
  pendingExistingLibEx = null;
  newExerciseName = name;
  newExerciseReps = 10;
  document.getElementById("new-exercise-name-display").textContent = name;
  document.getElementById("confirm-add-exercise-verb").textContent = swapTargetExerciseSessionId ? "Remplacer par" : "Ajouter";
  document.getElementById("new-exercise-reps-value").textContent = "10";
  document.getElementById("new-exercise-type-field").hidden = false;
  // Remise à zéro du choix de gif à chaque nouvel exercice créé depuis la séance.
  newExerciseGifKind = "link";
  newExerciseGifFileDataUrl = null;
  document.getElementById("new-exercise-gif-link").value = "";
  document.getElementById("new-exercise-gif-file").value = "";
  document.querySelectorAll("#new-exercise-gif-kind button").forEach((b) => b.classList.toggle("sel", b.dataset.val === "link"));
  document.getElementById("new-exercise-gif-link-field").hidden = false;
  document.getElementById("new-exercise-gif-file-field").hidden = true;
  document.getElementById("new-exercise-gif-kind-field").hidden = false;
  document.getElementById("new-exercise-form").hidden = false;
}

// Un exercice de la bibliothèque existe déjà (trouvé par la recherche) : on
// demande juste le nombre de répétitions avant de l'ajouter à la séance,
// sans redemander son type (déjà connu).
function openReprsStepForExisting(libEx) {
  pendingExistingLibEx = libEx;
  newExerciseName = libEx.name;
  newExerciseReps = 10;
  document.getElementById("new-exercise-name-display").textContent = libEx.name;
  document.getElementById("confirm-add-exercise-verb").textContent = swapTargetExerciseSessionId ? "Remplacer par" : "Ajouter";
  document.getElementById("new-exercise-reps-value").textContent = "10";
  document.getElementById("new-exercise-type-field").hidden = true;
  document.getElementById("new-exercise-gif-kind-field").hidden = true;
  document.getElementById("new-exercise-gif-link-field").hidden = true;
  document.getElementById("new-exercise-gif-file-field").hidden = true;
  document.getElementById("new-exercise-form").hidden = false;
}

async function addExerciseToSession(libraryExercise, targetReps) {
  const session = await Db.getSession(currentSessionId);
  const existing = await Db.getExerciseSessionsForSession(currentSessionId);
  await Db.addExerciseSession({
    sessionId: currentSessionId,
    libraryExerciseId: libraryExercise.id,
    name: libraryExercise.name,
    type: libraryExercise.type,
    targetReps: targetReps || 10,
    order: existing.length,
    rounds: [],
  });
  await bumpLibraryUsage(libraryExercise.id);
  closeExerciseModal();
  await renderExerciseList();
}

// Remplace un exercice deja present dans la seance par un autre (sans
// changer sa position) - les tours deja saisis sont remis a zero, car un
// poids/ressenti note pour un exercice n'a pas de sens pour un autre.
async function swapExerciseInSession(exerciseSessionId, libraryExercise, targetReps) {
  const all = await Db.getExerciseSessionsForSession(currentSessionId);
  const ex = all.find((e) => e.id === exerciseSessionId);
  if (!ex) return;
  ex.libraryExerciseId = libraryExercise.id;
  ex.name = libraryExercise.name;
  ex.type = libraryExercise.type;
  ex.targetReps = targetReps || ex.targetReps;
  ex.rounds = [];
  await Db.updateExerciseSession(ex);
  await bumpLibraryUsage(libraryExercise.id);
  closeExerciseModal();
  await renderExerciseList();
  reopenCard(ex.id); // garde la carte ouverte sur le nouvel exercice
}

async function confirmAddExerciseFromModal() {
  // Avant, une erreur ici (ex. un gif photo trop volumineux pour être
  // enregistré) échouait en silence : le bouton ne faisait plus rien et
  // Christine avait l'impression que « l'ajout d'un nouvel exercice ne
  // marche pas », sans aucun message. On attrape maintenant l'erreur pour
  // au moins la prévenir au lieu de rester bloquée sans explication.
  try {
    if (pendingExistingLibEx) {
      if (swapTargetExerciseSessionId) {
        await swapExerciseInSession(swapTargetExerciseSessionId, pendingExistingLibEx, newExerciseReps);
        return;
      }
      await addExerciseToSession(pendingExistingLibEx, newExerciseReps);
      return;
    }
    if (!newExerciseName) return;
    const type = document.getElementById("new-exercise-type").value;
    let gif = null;
    if (newExerciseGifKind === "link") {
      const url = document.getElementById("new-exercise-gif-link").value.trim();
      if (url) gif = { kind: "link", value: url };
    } else if (newExerciseGifKind === "file" && newExerciseGifFileDataUrl) {
      gif = { kind: "file", value: newExerciseGifFileDataUrl };
    }
    // Mis en favori automatiquement : comme la modale d'ajout filtre
    // maintenant par défaut sur les favoris, un exercice tout juste créé
    // (donc pas encore favori) disparaissait de la liste dès la séance
    // suivante et donnait l'impression de ne pas avoir été enregistré -
    // bug remonté par Christine.
    const libEx = await Db.addLibraryExercise({ name: newExerciseName, type, gif, favorite: true });
    if (swapTargetExerciseSessionId) {
      await swapExerciseInSession(swapTargetExerciseSessionId, libEx, newExerciseReps);
      return;
    }
    await addExerciseToSession(libEx, newExerciseReps);
  } catch (err) {
    console.error("[carnet-muscu] échec de l'ajout de l'exercice :", err);
    alert("Impossible d'enregistrer cet exercice (" + (err && err.message ? err.message : "erreur inconnue") + "). Si tu avais choisi une photo/gif volumineux, réessaie avec un lien ou sans gif.");
  }
}

// ---------- Progrès ----------

let progressSelectedLibId = null;
let progressShowTable = false;

async function renderProgressList(filterText) {
  const listEl = document.getElementById("progress-list");
  listEl.innerHTML = "";
  const allEx = await Db.getAllExerciseSessions();
  const counts = new Map(); // libraryExerciseId -> nombre de séances
  for (const ex of allEx) {
    if (!ex.libraryExerciseId) continue;
    counts.set(ex.libraryExerciseId, (counts.get(ex.libraryExerciseId) || 0) + 1);
  }
  // Nom actuel (pas celui enregistré au moment de l'ajout, qui peut être
  // périmé depuis un renommage dans la bibliothèque).
  const withNames = await Promise.all(
    [...counts.entries()].map(async ([libId, count]) => {
      const libEx = await Db.getLibraryExercise(libId);
      return libEx ? { libId, count, name: libEx.name } : null;
    })
  );
  const q = (filterText || "").trim().toLowerCase();
  const entries = withNames
    .filter(Boolean)
    .filter((v) => matchesSearch(v.name, q))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "fr"))
    .map((v) => [v.libId, v]);

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "progress-empty";
    empty.textContent = counts.size === 0
      ? "Pas encore d'historique - ajoute des séances pour voir ta progression ici."
      : "Aucun exercice ne correspond à cette recherche.";
    listEl.appendChild(empty);
    return;
  }

  for (const [libId, v] of entries) {
    const item = document.createElement("button");
    item.className = "progress-item";
    item.innerHTML = `
      <span class="progress-item-name">${escapeHtml(v.name)}</span>
      <span class="progress-item-count">${v.count} séance${v.count > 1 ? "s" : ""}</span>
    `;
    item.addEventListener("click", () => openProgressDetail(libId, v.name));
    listEl.appendChild(item);
  }
}

async function openProgressDetail(libId, name) {
  progressSelectedLibId = libId;
  progressShowTable = false;
  document.getElementById("progress-detail-name").textContent = name;
  document.getElementById("progress-list-wrap").hidden = true;
  document.getElementById("progress-detail-wrap").hidden = false;
  await renderProgressDetail();
}

function closeProgressDetail() {
  document.getElementById("progress-detail-wrap").hidden = true;
  document.getElementById("progress-list-wrap").hidden = false;
}

// Construit la série de points (date + valeur) pour un exercice : le poids
// total le plus lourd du jour pour barre/haltères, le nombre de répétitions
// cible pour poids du corps (aucune charge n'est suivie sur ce type-là).
async function buildProgressSeries(libId) {
  const [exSessions, sessions] = await Promise.all([
    Db.getExerciseSessionsByLibraryId(libId),
    Db.getAllSessions(),
  ]);
  const dateOf = new Map(sessions.map((s) => [s.id, s.date]));
  const points = [];
  for (const ex of exSessions) {
    const date = dateOf.get(ex.sessionId);
    if (!date) continue;
    if (isWeightlessType(ex.type)) {
      points.push({ date, value: ex.targetReps, unit: "reps" });
      continue;
    }
    let best = null;
    for (const round of ex.rounds || []) {
      if (!round.weight) continue;
      const total = ex.type === "barre"
        ? round.weight.bar + round.weight.added * 2
        : round.weight.perHand * 2;
      if (best === null || total > best) best = total;
    }
    if (best !== null) points.push({ date, value: best, unit: "kg" });
  }
  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return points;
}

function formatProgressValue(value, unit) {
  return unit === "kg" ? `${Math.round(value * 10) / 10} kg` : `${value} reps`;
}

async function renderProgressDetail() {
  const body = document.getElementById("progress-detail-body");
  body.innerHTML = "";
  const points = await buildProgressSeries(progressSelectedLibId);

  if (points.length === 0) {
    const empty = document.createElement("div");
    empty.className = "progress-empty";
    empty.textContent = "Pas encore de charge ou de répétitions enregistrées pour cet exercice.";
    body.appendChild(empty);
    return;
  }

  const unit = points[points.length - 1].unit;
  const best = Math.max(...points.map((p) => p.value));
  const record = document.createElement("div");
  record.className = "progress-record";
  record.innerHTML = `<span class="l">Record</span><span class="n">${formatProgressValue(best, unit)}</span>`;
  body.appendChild(record);

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "progress-table-toggle";
  toggleBtn.textContent = progressShowTable ? "Voir le graphique" : "Voir en tableau";
  toggleBtn.addEventListener("click", () => {
    progressShowTable = !progressShowTable;
    renderProgressDetail();
  });
  body.appendChild(toggleBtn);

  body.appendChild(progressShowTable ? buildProgressTable(points, unit) : buildProgressChart(points, unit));
}

function buildProgressTable(points, unit) {
  const table = document.createElement("table");
  table.className = "progress-table";
  const rows = points.slice().reverse().map(
    (p) => `<tr><td>${formatDateFr(p.date)}</td><td>${formatProgressValue(p.value, unit)}</td></tr>`
  ).join("");
  table.innerHTML = `<thead><tr><th>Date</th><th>${unit === "kg" ? "Charge" : "Répétitions"}</th></tr></thead><tbody>${rows}</tbody>`;
  return table;
}

// Petit graphique en ligne, dessiné à la main (pas de librairie externe) :
// une seule série donc pas de légende, marqueurs >= 8px avec liseré clair,
// valeur affichée directement sur le dernier point, infobulle au toucher sur
// chaque point (zone de contact agrandie pour rester facile à toucher).
function buildProgressChart(points, unit) {
  const wrap = document.createElement("div");
  wrap.className = "progress-chart-wrap";

  const W = 320, H = 160, padL = 8, padR = 8, padT = 22, padB = 22;
  const values = points.map((p) => p.value);
  let minV = Math.min(...values), maxV = Math.max(...values);
  if (minV === maxV) { minV -= 1; maxV += 1; }
  const spanV = maxV - minV;
  minV -= spanV * 0.12;
  maxV += spanV * 0.12;

  const n = points.length;
  const xAt = (i) => padL + (n === 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
  const yAt = (v) => padT + (1 - (v - minV) / (maxV - minV)) * (H - padT - padB);

  const linePts = points.map((p, i) => `${xAt(i)},${yAt(p.value)}`).join(" ");
  const areaPts = `${xAt(0)},${H - padB} ${linePts} ${xAt(n - 1)},${H - padB}`;
  const lastX = xAt(n - 1), lastY = yAt(points[n - 1].value);
  const labelAbove = lastY > padT + 14;

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Évolution ${unit === "kg" ? "de la charge" : "des répétitions"} pour cet exercice">`;
  svg += `<line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="var(--line)" stroke-width="1"/>`;
  svg += `<polygon points="${areaPts}" fill="var(--accent)" opacity="0.1"/>`;
  svg += `<polyline points="${linePts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  svg += `<text x="${xAt(0)}" y="${H - 4}" font-size="9" fill="var(--muted)" text-anchor="start">${formatDateFr(points[0].date)}</text>`;
  if (n > 1) {
    svg += `<text x="${xAt(n - 1)}" y="${H - 4}" font-size="9" fill="var(--muted)" text-anchor="end">${formatDateFr(points[n - 1].date)}</text>`;
  }
  points.forEach((p, i) => {
    svg += `<circle cx="${xAt(i)}" cy="${yAt(p.value)}" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>`;
  });
  svg += `<text x="${lastX}" y="${labelAbove ? lastY - 10 : lastY + 16}" font-size="11" font-weight="600" fill="var(--ink)" text-anchor="middle">${formatProgressValue(points[n - 1].value, unit)}</text>`;
  svg += `</svg>`;
  wrap.innerHTML = svg;

  const tooltip = document.createElement("div");
  tooltip.className = "progress-tooltip";
  wrap.appendChild(tooltip);

  const svgEl = wrap.querySelector("svg");
  points.forEach((p, i) => {
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    hit.setAttribute("cx", xAt(i));
    hit.setAttribute("cy", yAt(p.value));
    hit.setAttribute("r", "14");
    hit.setAttribute("fill", "transparent");
    hit.style.cursor = "pointer";
    hit.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const rect = svgEl.getBoundingClientRect();
      const scaleX = rect.width / W, scaleY = rect.height / H;
      tooltip.textContent = `${formatDateFr(p.date)} · ${formatProgressValue(p.value, unit)}`;
      tooltip.style.left = `${xAt(i) * scaleX}px`;
      tooltip.style.top = `${Math.max(0, yAt(p.value) * scaleY - 8)}px`;
      tooltip.classList.add("show");
    });
    svgEl.appendChild(hit);
  });

  return wrap;
}

// ---------- Export / import ----------
//
// L'app ne stocke rien en ligne (vie privée) : chaque appareil (téléphone,
// ordinateur...) a sa PROPRE copie locale des données, dans le stockage du
// navigateur. Un renommage ou un favori ajouté sur l'ordinateur n'apparaît
// donc jamais tout seul sur le téléphone, et inversement - ce sont deux
// bases séparées. L'export/import ci-dessous sert de pont manuel entre
// appareils : on exporte sur l'un, on transfère le fichier (AirDrop, mail...),
// on importe sur l'autre.

async function exportSessions() {
  const sessions = await Db.getAllSessions();
  const fullSessions = [];
  for (const s of sessions) {
    const exs = await Db.getExerciseSessionsForSession(s.id);
    fullSessions.push({ ...s, exercises: exs });
  }
  const library = await Db.getAllLibraryExercises();
  const data = { version: 1, exportedAt: new Date().toISOString(), sessions: fullSessions, library };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `carnet-musculation-sauvegarde-${todayIso()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Importe un fichier exporté par exportSessions ci-dessus. Un import ne
// SUPPRIME jamais rien sur cet appareil : chaque séance/exercice de
// bibliothèque du fichier est ajouté s'il n'existe pas encore ici, ou mis à
// jour s'il existe déjà (même id) - ce qui est justement ce qu'il faut pour
// faire arriver un renommage ou un favori fait ailleurs. Accepte aussi
// l'ancien format d'export (un simple tableau de séances, sans bibliothèque).
async function importBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (err) {
    alert("Ce fichier n'est pas une sauvegarde valide de cette app.");
    return;
  }
  const sessions = Array.isArray(data) ? data : Array.isArray(data.sessions) ? data.sessions : [];
  const library = Array.isArray(data.library) ? data.library : [];

  if (sessions.length === 0 && library.length === 0) {
    alert("Ce fichier ne contient ni séance ni exercice de bibliothèque à importer.");
    return;
  }
  if (!confirm(`Importer ${sessions.length} séance(s) et ${library.length} exercice(s) de bibliothèque depuis ce fichier ? Rien ne sera supprimé sur cet appareil, seulement ajouté ou mis à jour.`)) {
    return;
  }

  let sessionCount = 0, exerciseCount = 0;
  for (const s of sessions) {
    if (!s || !s.id) continue;
    const { exercises, ...sessionFields } = s;
    await Db.updateSession(sessionFields);
    sessionCount++;
    for (const ex of exercises || []) {
      if (!ex || !ex.id) continue;
      await Db.updateExerciseSession(ex);
      exerciseCount++;
    }
  }
  let libraryCount = 0, librarySkippedCount = 0;
  for (const libEx of library) {
    if (!libEx || !libEx.id) continue;
    // Ne jamais écraser une modification locale (renommage, favori) plus
    // récente que celle importée : on ne remplace que si l'exercice importé
    // est plus récent (ou si aucun des deux n'a de date, comportement
    // d'origine conservé pour ne rien casser sur d'anciennes sauvegardes).
    const local = await Db.getLibraryExercise(libEx.id);
    if (local && local.updatedAt && libEx.updatedAt && libEx.updatedAt < local.updatedAt) {
      librarySkippedCount++;
      continue;
    }
    await Db.updateLibraryExercise(libEx);
    libraryCount++;
  }

  const skippedMsg = librarySkippedCount > 0
    ? ` (${librarySkippedCount} exercice(s) de bibliothèque déjà plus récents sur cet appareil ont été conservés tels quels)`
    : "";
  alert(`Import terminé : ${sessionCount} séance(s) et ${libraryCount} exercice(s) de bibliothèque mis à jour (${exerciseCount} exercice(s) de séance).${skippedMsg}`);
  await renderJournal(document.getElementById("journal-search").value);
  if (document.getElementById("view-library").classList.contains("active")) {
    await renderLibrary(document.getElementById("library-search").value);
  }
}

// ---------- Câblage des événements et démarrage ----------

// Cable un ecouteur seulement si l'element existe. Avant ce garde-fou, un
// seul id manquant (typiquement une page HTML restee en cache pendant qu'un
// nouveau js/app.js a deja ete recupere) faisait planter tout le reste de
// init() d'un coup - plus aucun bouton de l'appli ne repondait, y compris
// ouvrir une seance, alors que le probleme venait d'un seul champ. Chaque
// petit bug de cablage reste desormais isole a la fonctionnalite concernee.
function on(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
  else console.warn(`[carnet-muscu] élément #${id} introuvable - vérifie que la page est à jour (ferme et rouvre l'appli).`);
}

async function init() {
  await Db.init();
  seedPublicLibraryIfNeeded().then(() => {
    // Une fois l'import terminé, on rafraîchit la bibliothèque si elle est
    // affichée (premier lancement, avec connexion).
    if (document.getElementById("view-library").classList.contains("active")) {
      renderLibrary(document.getElementById("library-search").value);
    }
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  document.querySelectorAll('.navitem[data-nav="journal"]').forEach((btn) =>
    btn.addEventListener("click", async () => {
      await renderJournal();
      goTo("journal");
    })
  );
  document.querySelectorAll('.navitem[data-nav="library"]').forEach((btn) =>
    btn.addEventListener("click", async () => {
      await renderLibrary();
      goTo("library");
    })
  );
  document.querySelectorAll('.navitem[data-nav="add"]').forEach((btn) =>
    btn.addEventListener("click", openNewSessionForm)
  );
  document.querySelectorAll('.navitem[data-nav="progress"]').forEach((btn) =>
    btn.addEventListener("click", async () => {
      closeProgressDetail();
      await renderProgressList(document.getElementById("progress-search").value);
      goTo("progress");
    })
  );
  on("progress-search", "input", (e) => renderProgressList(e.target.value));
  on("progress-back-btn", "click", closeProgressDetail);
  // Cache l'infobulle du graphique de progrès si on touche ailleurs que le
  // graphique (un seul écouteur, jamais recréé, pour ne pas en accumuler à
  // chaque affichage du graphique).
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".progress-chart-wrap")) {
      document.querySelectorAll(".progress-tooltip.show").forEach((t) => t.classList.remove("show"));
    }
  });
  document.querySelectorAll("[data-go='journal']").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await renderJournal();
      goTo("journal");
    })
  );
  on("create-session-btn", "click", createSession);
  on("new-session-tours-minus", "click", () => stepNewSessionTours(-1));
  on("new-session-tours-plus", "click", () => stepNewSessionTours(1));
  on("session-tours-minus", "click", () => stepSessionTours(-1));
  on("session-tours-plus", "click", () => stepSessionTours(1));
  on("duplicate-session-btn", "click", () => {
    if (currentSessionId) duplicateSession(currentSessionId);
  });
  on("delete-session-btn", "click", async () => {
    const session = await Db.getSession(currentSessionId);
    if (!session) return;
    if (!confirm(`Supprimer la séance « ${session.title} » du ${formatDateFr(session.date)} ? Cette action est définitive.`)) return;
    await Db.deleteSession(currentSessionId);
    await renderJournal();
    goTo("journal");
  });
  on("library-search", "input", (e) => renderLibrary(e.target.value));
  on("add-library-exercise-btn", "click", openLibraryAddModal);
  on("cancel-add-library-btn", "click", closeLibraryAddModal);
  on("confirm-add-library-btn", "click", confirmAddLibraryExercise);
  on("close-library-detail-btn", "click", closeLibraryDetail);
  document.querySelectorAll("#lib-new-gif-kind button").forEach((btn) => {
    btn.addEventListener("click", () => {
      libNewGifKind = btn.dataset.val;
      document.querySelectorAll("#lib-new-gif-kind button").forEach((b) => b.classList.toggle("sel", b === btn));
      document.getElementById("lib-new-gif-link-field").hidden = libNewGifKind !== "link";
      document.getElementById("lib-new-gif-file-field").hidden = libNewGifKind !== "file";
    });
  });
  on("lib-new-gif-file", "change", (e) => {
    const file = e.target.files[0];
    if (!file) { libNewGifFileDataUrl = null; return; }
    const reader = new FileReader();
    reader.onload = () => { libNewGifFileDataUrl = reader.result; };
    reader.readAsDataURL(file);
  });
  // Même principe pour le gif d'un tout nouvel exercice créé depuis une
  // séance (à la demande de Christine) - jusqu'ici on ne pouvait choisir un
  // gif qu'en passant par la bibliothèque.
  document.querySelectorAll("#new-exercise-gif-kind button").forEach((btn) => {
    btn.addEventListener("click", () => {
      newExerciseGifKind = btn.dataset.val;
      document.querySelectorAll("#new-exercise-gif-kind button").forEach((b) => b.classList.toggle("sel", b === btn));
      document.getElementById("new-exercise-gif-link-field").hidden = newExerciseGifKind !== "link";
      document.getElementById("new-exercise-gif-file-field").hidden = newExerciseGifKind !== "file";
    });
  });
  on("new-exercise-gif-file", "change", (e) => {
    const file = e.target.files[0];
    if (!file) { newExerciseGifFileDataUrl = null; return; }
    const reader = new FileReader();
    reader.onload = () => { newExerciseGifFileDataUrl = reader.result; };
    reader.readAsDataURL(file);
  });
  on("add-exercise-btn", "click", openExerciseModal);
  on("cancel-add-exercise-btn", "click", closeExerciseModal);
  on("confirm-add-exercise-btn", "click", confirmAddExerciseFromModal);
  on("exercise-search-input", "input", (e) => searchExercisesInModal(e.target.value));
  on("new-exercise-reps-minus", "click", () => {
    newExerciseReps = Math.max(1, newExerciseReps - 1);
    document.getElementById("new-exercise-reps-value").textContent = newExerciseReps;
  });
  on("new-exercise-reps-plus", "click", () => {
    newExerciseReps = newExerciseReps + 1;
    document.getElementById("new-exercise-reps-value").textContent = newExerciseReps;
  });
  on("journal-search", "input", (e) => renderJournal(e.target.value));
  on("export-btn", "click", exportSessions);
  on("import-btn", "click", () => {
    document.getElementById("import-file-input").click();
  });
  on("import-file-input", "change", async (e) => {
    const file = e.target.files[0];
    e.target.value = ""; // pour pouvoir réimporter le même fichier plus tard si besoin
    if (file) await importBackup(file);
  });
  // Ferme n'importe quelle fenêtre (gif, ajout d'exercice...) si on touche
  // à côté, en dehors de son contenu.
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) backdrop.classList.remove("open");
    });
  });

  await renderJournal();
  goTo("journal");
}

document.addEventListener("DOMContentLoaded", init);

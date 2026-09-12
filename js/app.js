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
      // Les exercices de cette séance ne seront plus "utilisés" une fois la
      // séance supprimée - il faut le savoir AVANT de supprimer (sinon plus
      // moyen de retrouver quels exercices étaient concernés).
      const affectedIds = (await Db.getExerciseSessionsForSession(s.id)).map((e) => e.libraryExerciseId).filter(Boolean);
      await Db.deleteSession(s.id);
      for (const id of new Set(affectedIds)) await recomputeLibraryUsageCount(id);
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
  // Renommer une séance (à la demande de Christine) - même principe que le
  // renommage d'un exercice de bibliothèque : un crayon ouvre un champ
  // inline, pas de modale séparée.
  document.getElementById("session-rename-field").hidden = true;
  document.getElementById("session-rename-btn").onclick = () => {
    document.getElementById("session-rename-input").value = session.title;
    document.getElementById("session-rename-field").hidden = false;
    document.getElementById("session-rename-input").focus();
  };
  document.getElementById("session-rename-cancel").onclick = () => {
    document.getElementById("session-rename-field").hidden = true;
  };
  document.getElementById("session-rename-save").onclick = async () => {
    const newTitle = document.getElementById("session-rename-input").value.trim();
    if (!newTitle) return;
    session.title = newTitle;
    await Db.updateSession(session);
    document.getElementById("session-title-display").textContent = session.title;
    document.getElementById("session-rename-field").hidden = true;
    await renderJournal(document.getElementById("journal-search").value);
  };
  // Modifier la date d'une séance déjà enregistrée (demande de Christine du
  // 13/09/2026) - même principe inline que le renommage ci-dessus.
  document.getElementById("session-date-edit-field").hidden = true;
  document.getElementById("session-date-edit-btn").onclick = () => {
    document.getElementById("session-date-edit-input").value = session.date;
    document.getElementById("session-date-edit-field").hidden = false;
  };
  document.getElementById("session-date-edit-cancel").onclick = () => {
    document.getElementById("session-date-edit-field").hidden = true;
  };
  document.getElementById("session-date-edit-save").onclick = async () => {
    const newDate = document.getElementById("session-date-edit-input").value;
    if (!newDate) return;
    session.date = newDate;
    await Db.updateSession(session);
    document.getElementById("session-date-display").textContent = formatDateFr(session.date);
    document.getElementById("session-date-edit-field").hidden = true;
    await renderJournal(document.getElementById("journal-search").value);
  };
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
    // Sans ce recalcul, l'exercice resterait marqué "utilisé" dans la
    // bibliothèque alors qu'il vient d'être retiré de cette séance - même
    // bug que pour "changer d'exercice" (voir swapExerciseInSession).
    await recomputeLibraryUsageCount(ex.libraryExerciseId);
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

// Recalcule le "utilisé X×" d'un exercice de bibliothèque à partir des VRAIES
// séances qui l'utilisent encore (Db.getExerciseSessionsByLibraryId), plutôt
// que de maintenir un compteur qu'on incrémente à la main.
//
// Pourquoi : un compteur incrémenté au moment d'AJOUTER l'exercice à une
// séance (voir l'historique de bumpLibraryUsage) se déréglait dès qu'on
// changeait d'avis - "changer d'exercice" dans une séance (swapExerciseInSession)
// ou simplement le supprimer avant d'avoir fait un seul tour incrémentait
// quand même le compteur, qui ne redescendait jamais. Résultat pour Christine :
// des exercices marqués "utilisé X×" qu'elle n'avait en réalité jamais faits
// (ex. "Band bent-over hip extension", juste survolé en cherchant un autre
// exercice). En recalculant depuis les exerciseSessions à chaque fois qu'une
// séance change (ajout, remplacement, suppression - voir les appels de cette
// fonction et de recomputeLibraryUsageCount), le compteur reflète toujours
// exactement ce qui est réellement dans les séances, sans jamais dériver.
async function recomputeLibraryUsageCount(libraryExerciseId) {
  if (!libraryExerciseId) return;
  const libEx = await Db.getLibraryExercise(libraryExerciseId);
  if (!libEx) return;
  const uses = await Db.getExerciseSessionsByLibraryId(libraryExerciseId);
  libEx.usageCount = uses.length;
  await Db.updateLibraryExercise(libEx);
}

// Appelé quand un exercice est ajouté ou remplacé dans une séance (voir
// addExerciseToSession et swapExerciseInSession) : recalcule son compteur
// d'utilisation réel, et le marque favori automatiquement au passage - la
// modale d'ajout filtre par défaut sur les favoris (à la demande de
// Christine), donc un exercice utilisé mais jamais favorisé à la main (le
// cas de tous les exercices importés de la bibliothèque publique, comme
// "Hip Thrust") disparaissait de la liste dès la séance suivante.
async function bumpLibraryUsage(libraryExerciseId) {
  const libEx = await Db.getLibraryExercise(libraryExerciseId);
  if (!libEx) return;
  // Correctif du 13/09/2026 : ce favori automatique ne doit jouer qu'à la
  // TOUTE PREMIÈRE utilisation de l'exercice (usageCount encore à 0) - avant
  // ce correctif, il se redéclenchait à CHAQUE ajout/remplacement/duplication
  // de séance, et réécrasait donc systématiquement un favori que Christine
  // avait sciemment retiré entre-temps (exactement le bug "j'enlève un
  // favori, il revient" qu'elle a signalé - reproductible dès qu'elle
  // rajoutait ou dupliquait une séance avec cet exercice, sans lien avec la
  // synchro cloud). Sur les utilisations suivantes, on ne touche plus du
  // tout au favori : seul le compteur d'utilisation est mis à jour.
  if (!(libEx.usageCount > 0) && !libEx.favorite) {
    libEx.favorite = true;
    await Db.updateLibraryExercise(libEx);
  }
  await recomputeLibraryUsageCount(libraryExerciseId);
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
  // Remplacer le gif par un lien (à la demande de Christine, après qu'une
  // photo ajoutée depuis son téléphone ait rendu une sauvegarde trop
  // volumineuse pour la synchronisation cloud - voir js/sync.js). Ne propose
  // volontairement que "lien", jamais "photo", pour ne pas recréer le
  // problème qu'on est en train de corriger.
  const gifField = document.getElementById("lib-detail-gif-field");
  const gifInput = document.getElementById("lib-detail-gif-input");
  gifField.hidden = true;
  document.getElementById("lib-detail-gif-btn").onclick = () => {
    gifInput.value = ex.gif && ex.gif.kind === "link" ? ex.gif.value : "";
    gifField.hidden = false;
    gifInput.focus();
  };
  document.getElementById("lib-detail-gif-cancel").onclick = () => {
    gifField.hidden = true;
  };
  document.getElementById("lib-detail-gif-save").onclick = async () => {
    const url = gifInput.value.trim();
    ex.gif = url ? { kind: "link", value: url } : null;
    ex.updatedAt = Date.now();
    await Db.updateLibraryExercise(ex);
    const gifUrl2 = gifUrlOf(ex);
    document.getElementById("lib-detail-gif").innerHTML = gifUrl2
      ? `<img src="${gifUrl2}" alt="${escapeHtml(ex.name)}">`
      : `<div class="lib-detail-noGif">pas de démonstration pour cet exercice</div>`;
    gifField.hidden = true;
  };
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
  const previousLibraryExerciseId = ex.libraryExerciseId; // voir recompute ci-dessous
  ex.libraryExerciseId = libraryExercise.id;
  ex.name = libraryExercise.name;
  ex.type = libraryExercise.type;
  ex.targetReps = targetReps || ex.targetReps;
  ex.rounds = [];
  await Db.updateExerciseSession(ex);
  await bumpLibraryUsage(libraryExercise.id);
  // L'exercice qu'on vient de remplacer n'est plus dans aucune séance sous
  // cet id (voir recomputeLibraryUsageCount) : sans ce recalcul, il resterait
  // marqué "utilisé" alors qu'on ne l'a fait que le temps de changer d'avis.
  if (previousLibraryExerciseId && previousLibraryExerciseId !== libraryExercise.id) {
    await recomputeLibraryUsageCount(previousLibraryExerciseId);
  }
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

// ---------- Graphique "séances par mois" ----------
// Ouvert depuis la tuile "séances / mois" du journal, à la demande de
// Christine. Même style de graphique dessiné à la main (SVG, pas de
// librairie) que le graphique de progrès par exercice, mais en barres plutôt
// qu'en ligne (un compte par mois, pas une valeur continue).
async function openSessionsPerMonthChart() {
  const sessions = await Db.getAllSessions();
  const body = document.getElementById("sessions-chart-body");
  body.innerHTML = "";
  body.appendChild(buildSessionsPerMonthChart(sessions));
  document.getElementById("sessions-chart-modal").classList.add("open");
}

// 12 derniers mois glissants (y compris ceux à 0 séance, pour voir les trous),
// du plus ancien au plus récent.
function buildSessionsPerMonthChart(sessions) {
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth(), count: 0 });
  }
  for (const s of sessions) {
    const d = new Date(s.date + "T00:00:00");
    const m = months.find((mo) => mo.year === d.getFullYear() && mo.month === d.getMonth());
    if (m) m.count++;
  }

  const wrap = document.createElement("div");
  wrap.className = "progress-chart-wrap";

  if (sessions.length === 0) {
    wrap.innerHTML = `<div class="progress-empty">Pas encore de séance enregistrée.</div>`;
    return wrap;
  }

  const W = 320, H = 180, padL = 8, padR = 8, padT = 22, padB = 26;
  const maxCount = Math.max(1, ...months.map((m) => m.count));
  const n = months.length;
  const gap = 6;
  const barW = (W - padL - padR - gap * (n - 1)) / n;
  const xAt = (i) => padL + i * (barW + gap);
  const yAt = (v) => padT + (1 - v / maxCount) * (H - padT - padB);
  const labelFr = (m) => new Date(m.year, m.month, 1).toLocaleDateString("fr-FR", { month: "short" }).replace(".", "");

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Nombre de séances par mois, 12 derniers mois">`;
  svg += `<line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="var(--line)" stroke-width="1"/>`;
  months.forEach((m, i) => {
    const x = xAt(i);
    const y = m.count > 0 ? yAt(m.count) : H - padB;
    const h = (H - padB) - y;
    svg += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="var(--accent)" opacity="${m.count > 0 ? 1 : 0.15}"/>`;
    if (m.count > 0) {
      svg += `<text x="${x + barW / 2}" y="${y - 5}" font-size="10" font-weight="600" fill="var(--ink)" text-anchor="middle">${m.count}</text>`;
    }
    // Un mois sur deux affiché si 12 mois (sinon trop serré) - toujours le dernier.
    if (i % 2 === 0 || i === n - 1) {
      svg += `<text x="${x + barW / 2}" y="${H - 8}" font-size="9" fill="var(--muted)" text-anchor="middle">${labelFr(m)}</text>`;
    }
  });
  svg += `</svg>`;
  wrap.innerHTML = svg;
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

// Construit l'objet complet de sauvegarde (séances + bibliothèque) - utilisé
// à la fois par l'export en fichier JSON ci-dessous et par la synchronisation
// cloud (voir js/sync.js), pour ne pas dupliquer cette logique à deux
// endroits.
async function buildBackupPayload() {
  const sessions = await Db.getAllSessions();
  const fullSessions = [];
  for (const s of sessions) {
    const exs = await Db.getExerciseSessionsForSession(s.id);
    fullSessions.push({ ...s, exercises: exs });
  }
  const library = await Db.getAllLibraryExercises();
  // libraryTombstones : voir le commentaire sur Db.deleteLibraryExercise -
  // sans ça, un exercice supprimé (notamment un doublon) revient tout seul
  // au prochain import/synchro, puisque mergeBackupData ne supprime jamais
  // rien de lui-même.
  const libraryTombstones = await Db.getAllLibraryTombstones();
  return { version: 1, exportedAt: new Date().toISOString(), sessions: fullSessions, library, libraryTombstones };
}

async function exportSessions() {
  const data = await buildBackupPayload();
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
// Fusionne un objet de sauvegarde (fichier importé OU récupéré du cloud, voir
// js/sync.js) dans la base locale. N'écrase et ne supprime jamais rien
// aveuglément : chaque séance/exercice de séance est ajouté ou mis à jour
// (même id), et un exercice de bibliothèque n'est remplacé que si sa version
// importée est plus récente (updatedAt) que celle déjà présente sur cet
// appareil - ce qui laisse un renommage ou un favori fait ailleurs (sur un
// autre appareil) arriver correctement sans perdre un changement plus récent
// fait ici. Retourne les compteurs, à afficher par l'appelant.
async function mergeBackupData(data) {
  // On coupe temporairement le hook de synchro automatique (voir Db._onWrite
  // dans js/db.js et js/sync.js) le temps de la fusion : sans ça, chaque
  // écriture faite ICI en train de recopier des données déjà reçues du
  // cloud programmerait un nouvel envoi automatique vers le cloud - un
  // aller-retour inutile (et, avec l'écoute en temps réel, potentiellement
  // une boucle). Couvre tous les appelants (import fichier, bouton
  // "Récupérer", écoute en temps réel), pas seulement l'un d'eux.
  const savedWriteHook = Db._onWrite;
  Db._onWrite = null;
  try {
    const sessions = Array.isArray(data) ? data : Array.isArray(data.sessions) ? data.sessions : [];
    const library = Array.isArray(data.library) ? data.library : [];
    const libraryTombstones = Array.isArray(data.libraryTombstones) ? data.libraryTombstones : [];

    // Applique d'abord les tombes reçues (voir Db.deleteLibraryExercise) -
    // AVANT les exercices de bibliothèque ci-dessous, pour qu'un exercice
    // supprimé ailleurs ne soit pas d'abord réimporté puis supprimé (ça
    // marcherait quand même, mais dans le mauvais ordre ça redéclencherait
    // un rendu/écriture inutile). Une tombe ne supprime ici que si elle est
    // plus récente que le dernier changement connu localement sur cet id
    // (même règle "le plus récent gagne" que pour le reste, avec le même
    // garde-fou anti-régression Db.recentLocalWriteTime) : si Christine a
    // recréé ou modifié cet exercice ICI après cette suppression-là ailleurs,
    // sa version locale l'emporte et n'est pas supprimée.
    let tombstoneCount = 0, tombstoneSkippedCount = 0;
    for (const t of libraryTombstones) {
      if (!t || !t.id || !t.deletedAt) continue;
      const localTombstone = await Db.getLibraryTombstone(t.id);
      if (localTombstone && localTombstone.deletedAt >= t.deletedAt) continue; // déjà connue, rien à faire
      const local = await Db.getLibraryExercise(t.id);
      const effectiveLocalLibUpdatedAt = Math.max((local && local.updatedAt) || 0, Db.recentLocalWriteTime(t.id));
      if (local && effectiveLocalLibUpdatedAt > t.deletedAt) {
        tombstoneSkippedCount++;
        continue; // modifié ici après cette suppression-là : on garde la version locale
      }
      if (local) await Db.deleteLibraryExerciseRecordOnly(t.id);
      await Db.recordLibraryTombstone(t.id, t.deletedAt);
      tombstoneCount++;
    }

    // Règle de fusion, identique pour séances / exercices de séance /
    // bibliothèque : on ne prend un enregistrement venu d'ailleurs (fichier
    // importé ou cloud) que s'il est plus récent que la version déjà présente
    // sur cet appareil (updatedAt). Sinon on le saute - la version locale est
    // gardée telle quelle. Objectif explicite de Christine (12/09/2026) :
    // "je ne veux pas perdre de données, ne jamais prendre les données en
    // cache ou en local [à la place d'une version plus récente]". On ne
    // supprime jamais rien ici (mergeBackupData n'efface jamais un
    // enregistrement absent du payload reçu - seul un vrai bouton
    // "supprimer" le fait). `{preserveTimestamp: true}` : on réapplique
    // l'horodatage d'origine de l'enregistrement reçu, pas "maintenant" -
    // sinon une prochaine fusion ne pourrait plus jamais départager deux
    // versions correctement (voir le commentaire sur updateSession, js/db.js).
    // `Db.recentLocalWriteTime(id)` : garde-fou supplémentaire (voir le
    // commentaire dans js/db.js) - on compare l'enregistrement reçu au PLUS
    // RÉCENT de l'horodatage lu en base et de celui d'une écriture directe
    // toute fraîche sur cet appareil, jamais à un seul des deux. Un
    // enregistrement reçu réellement plus récent est donc toujours appliqué
    // normalement (la fusion multi-appareils continue de fonctionner) ; seul
    // un enregistrement reçu qui semblerait "aussi récent ou plus vieux" à
    // cause d'une comparaison qui se serait trompée (deux écritures très
    // rapprochées, par exemple) est protégé. Corrige un bug réel constaté le
    // 13/09/2026 : un favori enlevé qui redevenait favori quelques secondes
    // plus tard, au moment précis où l'envoi automatique se déclenchait.
    let sessionCount = 0, sessionSkippedCount = 0, exerciseCount = 0, exerciseSkippedCount = 0;
    for (const s of sessions) {
      if (!s || !s.id) continue;
      const { exercises, ...sessionFields } = s;
      const localSession = await Db.getSession(s.id);
      const effectiveLocalUpdatedAt = Math.max(
        (localSession && localSession.updatedAt) || 0,
        Db.recentLocalWriteTime(s.id)
      );
      if (effectiveLocalUpdatedAt && sessionFields.updatedAt && sessionFields.updatedAt <= effectiveLocalUpdatedAt) {
        sessionSkippedCount++;
      } else {
        await Db.updateSession(sessionFields, { preserveTimestamp: true });
        sessionCount++;
      }
      for (const ex of exercises || []) {
        if (!ex || !ex.id) continue;
        const localEx = await Db.getExerciseSession(ex.id);
        const effectiveLocalExUpdatedAt = Math.max((localEx && localEx.updatedAt) || 0, Db.recentLocalWriteTime(ex.id));
        if (effectiveLocalExUpdatedAt && ex.updatedAt && ex.updatedAt <= effectiveLocalExUpdatedAt) {
          exerciseSkippedCount++;
          continue;
        }
        await Db.updateExerciseSession(ex, { preserveTimestamp: true });
        exerciseCount++;
      }
    }
    let libraryCount = 0, librarySkippedCount = 0;
    for (const libEx of library) {
      if (!libEx || !libEx.id) continue;
      // Ne réimporte pas un exercice que Christine a supprimé ICI depuis
      // (tombe locale plus récente que la version reçue) - sans ce test, un
      // exercice tout juste supprimé (doublon, erreur de saisie...)
      // reviendrait dès la prochaine synchro simplement parce que l'autre
      // appareil (ou le cloud) l'a encore dans son état.
      const tombstone = await Db.getLibraryTombstone(libEx.id);
      if (tombstone && tombstone.deletedAt >= (libEx.updatedAt || 0)) {
        librarySkippedCount++;
        continue;
      }
      const local = await Db.getLibraryExercise(libEx.id);
      const effectiveLocalLibUpdatedAt = Math.max((local && local.updatedAt) || 0, Db.recentLocalWriteTime(libEx.id));
      if (effectiveLocalLibUpdatedAt && libEx.updatedAt && libEx.updatedAt <= effectiveLocalLibUpdatedAt) {
        librarySkippedCount++;
        continue;
      }
      await Db.updateLibraryExercise(libEx, { preserveTimestamp: true });
      // usageCount ne doit JAMAIS venir tel quel d'un appareil ou d'un
      // ancien instantané du cloud : c'est une valeur dérivée, qui ne peut
      // être fiable que recalculée depuis les VRAIES exerciseSessions
      // présentes ICI. Sans cette ligne, un compteur faux poussé par un
      // autre appareil (ou une vieille sauvegarde jamais repassée par la
      // migration migrateUsageCountsFromRealData) écrase la valeur
      // correcte à chaque synchro et y reste pour toujours, même si cet
      // appareil avait déjà le bon chiffre - cas réel signalé par Christine
      // le 12/09/2026 : "Kettlebell alternating renegade row" marqué comme
      // utilisé dans la bibliothèque, alors qu'il n'apparaît dans aucune
      // séance ni dans Progrès (qui, eux, comptent les vraies données).
      await recomputeLibraryUsageCount(libEx.id);
      libraryCount++;
    }

    await renderJournal(document.getElementById("journal-search").value);
    if (document.getElementById("view-library").classList.contains("active")) {
      await renderLibrary(document.getElementById("library-search").value);
    }
    return {
      sessionCount,
      sessionSkippedCount,
      exerciseCount,
      exerciseSkippedCount,
      libraryCount,
      librarySkippedCount,
      tombstoneCount,
      tombstoneSkippedCount,
      sessionsSeen: sessions.length,
      librarySeen: library.length,
    };
  } finally {
    Db._onWrite = savedWriteHook;
  }
}

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

  const { sessionCount, exerciseCount, libraryCount, librarySkippedCount } = await mergeBackupData(data);
  const skippedMsg = librarySkippedCount > 0
    ? ` (${librarySkippedCount} exercice(s) de bibliothèque déjà plus récents sur cet appareil ont été conservés tels quels)`
    : "";
  alert(`Import terminé : ${sessionCount} séance(s) et ${libraryCount} exercice(s) de bibliothèque mis à jour (${exerciseCount} exercice(s) de séance).${skippedMsg}`);
}

// ---------- Import de séance depuis une photo (lecture IA, voir js/ai.js) ----------
// À la demande de Christine (12/09/2026) : lire une photo (note manuscrite,
// capture d'écran d'un programme...) pour pré-remplir une séance à venir,
// sans jamais rien enregistrer avant qu'elle ait validé chaque ligne à
// l'écran. `aiImportDraft` garde l'état du brouillon en cours pendant que la
// modale est ouverte (rempli par openAiImportFlow, relu par confirmAiImport).
let aiImportDraft = null;

function setAiImportModalState(state) {
  // state : "loading" | "error" | "review"
  document.getElementById("ai-import-loading").hidden = state !== "loading";
  document.getElementById("ai-import-error").hidden = state !== "error";
  document.getElementById("ai-import-review").hidden = state !== "review";
  document.getElementById("ai-import-review-actions").hidden = state !== "review";
}

async function openAiImportFlow(file) {
  aiImportDraft = null;
  setAiImportModalState("loading");
  document.getElementById("ai-import-modal").classList.add("open");
  try {
    const [result, library] = await Promise.all([analyzeSessionPhoto(file), Db.getAllLibraryExercises()]);
    if (result.exercises.length === 0) {
      throw new Error("Aucun exercice n'a été reconnu sur cette photo. Réessaie avec une photo plus nette, ou ajoute la séance à la main.");
    }
    aiImportDraft = {
      title: "Séance importée",
      date: todayIso(),
      tours: result.tours,
      rows: result.exercises.map((ex) => {
        const candidates = matchLibraryExercises(ex.name, library);
        return {
          rawName: ex.name,
          reps: ex.reps || 10,
          note: ex.note || "",
          candidates,
          // Une correspondance n'est pré-cochée que si elle est quasi certaine
          // (nom identique une fois normalisé) - dans le doute, Christine
          // choisit elle-même plutôt que de valider un mauvais rattachement
          // sans le remarquer.
          selectedId: candidates[0] && normalizeForMatch(candidates[0].name) === normalizeForMatch(ex.name) ? candidates[0].id : "",
          excluded: false,
        };
      }),
    };
    renderAiImportReview();
    setAiImportModalState("review");
  } catch (err) {
    document.getElementById("ai-import-error-text").textContent = err.message || "Échec de la lecture de la photo.";
    setAiImportModalState("error");
  }
}

// Vignette GIF pour une ligne du brouillon d'import, comme quand on ajoute
// un exercice à la main (demande de Christine du 12/09/2026) - montre le
// GIF de l'exercice actuellement sélectionné dans le menu déroulant, ou un
// espace vide si rien n'est choisi ou si cet exercice n'a pas de GIF.
function aiImportRowGifHtml(row) {
  const selected = row.candidates.find((c) => c.id === row.selectedId);
  const gifUrl = selected ? gifUrlOf(selected) : null;
  return gifUrl
    ? `<img src="${gifUrl}" alt="" loading="lazy">`
    : `<div class="ai-import-row-noGif">pas de démonstration</div>`;
}

function renderAiImportReview() {
  document.getElementById("ai-import-title-input").value = aiImportDraft.title;
  document.getElementById("ai-import-date-input").value = aiImportDraft.date;
  document.getElementById("ai-import-tours-input").value = aiImportDraft.tours;
  const container = document.getElementById("ai-import-rows");
  container.innerHTML = aiImportDraft.rows
    .map((row, i) => {
      const options = row.candidates
        .map((c) => `<option value="${escapeHtml(c.id)}" ${row.selectedId === c.id ? "selected" : ""}>${escapeHtml(c.name)} (${escapeHtml(typeLabel(c.type))})</option>`)
        .join("");
      return `
        <div class="ai-import-row${row.excluded ? " excluded" : ""}" data-index="${i}">
          <div class="ai-import-row-raw">Lu sur la photo : <b>${escapeHtml(row.rawName)}</b>${row.note ? ` — ${escapeHtml(row.note)}` : ""}</div>
          <div class="ai-import-row-main">
            <div class="ai-import-row-gif" data-index="${i}">${aiImportRowGifHtml(row)}</div>
            <div class="ai-import-row-fields-wrap">
              <select class="ai-import-row-select" data-index="${i}">
                <option value="">— choisir un exercice de la bibliothèque —</option>
                ${options}
              </select>
              <div class="ai-import-row-fields">
                <input type="number" class="ai-import-row-reps" data-index="${i}" min="1" value="${row.reps}">
                <input type="text" class="ai-import-row-note" data-index="${i}" placeholder="note (optionnel)" value="${escapeHtml(row.note)}">
              </div>
            </div>
          </div>
          <label class="ai-import-row-exclude-label">
            <input type="checkbox" class="ai-import-row-exclude" data-index="${i}" ${row.excluded ? "checked" : ""}>
            ne pas importer cet exercice
          </label>
        </div>`;
    })
    .join("");
  container.querySelectorAll(".ai-import-row-select").forEach((el) =>
    el.addEventListener("change", (e) => {
      const idx = Number(e.target.dataset.index);
      aiImportDraft.rows[idx].selectedId = e.target.value;
      const gifDiv = container.querySelector(`.ai-import-row-gif[data-index="${idx}"]`);
      if (gifDiv) gifDiv.innerHTML = aiImportRowGifHtml(aiImportDraft.rows[idx]);
    })
  );
  container.querySelectorAll(".ai-import-row-reps").forEach((el) =>
    el.addEventListener("input", (e) => {
      aiImportDraft.rows[Number(e.target.dataset.index)].reps = parseInt(e.target.value, 10) || 1;
    })
  );
  container.querySelectorAll(".ai-import-row-note").forEach((el) =>
    el.addEventListener("input", (e) => {
      aiImportDraft.rows[Number(e.target.dataset.index)].note = e.target.value;
    })
  );
  container.querySelectorAll(".ai-import-row-exclude").forEach((el) =>
    el.addEventListener("change", (e) => {
      const row = aiImportDraft.rows[Number(e.target.dataset.index)];
      row.excluded = e.target.checked;
      renderAiImportReview();
    })
  );
}

// Stepper +/- pour le nombre de tours du brouillon d'import (même logique
// que stepNewSessionTours pour la création manuelle d'une séance).
function stepAiImportTours(delta) {
  const input = document.getElementById("ai-import-tours-input");
  const min = parseInt(input.min, 10) || 1;
  const max = parseInt(input.max, 10) || 10;
  const next = Math.min(max, Math.max(min, (parseInt(input.value, 10) || min) + delta));
  input.value = next;
  aiImportDraft.tours = next;
}

async function confirmAiImport() {
  aiImportDraft.title = document.getElementById("ai-import-title-input").value.trim() || "Séance importée";
  aiImportDraft.date = document.getElementById("ai-import-date-input").value || todayIso();
  aiImportDraft.tours = parseInt(document.getElementById("ai-import-tours-input").value, 10) || 1;
  const included = aiImportDraft.rows.filter((r) => !r.excluded);
  const missing = included.filter((r) => !r.selectedId);
  if (missing.length > 0) {
    alert(`Choisis un exercice de bibliothèque pour chaque ligne avant de créer la séance (ou coche « ne pas importer » pour l'ignorer) : ${missing.map((r) => `« ${r.rawName} »`).join(", ")}.`);
    return;
  }
  if (included.length === 0) {
    alert("Toutes les lignes sont exclues - il n'y aurait aucun exercice dans cette séance.");
    return;
  }
  const library = await Db.getAllLibraryExercises();
  const session = await Db.addSession({
    date: aiImportDraft.date || todayIso(),
    title: aiImportDraft.title,
    tours: aiImportDraft.tours,
  });
  let order = 0;
  for (const row of included) {
    const libEx = library.find((e) => e.id === row.selectedId);
    if (!libEx) continue;
    await Db.addExerciseSession({
      sessionId: session.id,
      libraryExerciseId: libEx.id,
      name: libEx.name,
      type: libEx.type,
      targetReps: row.reps,
      order: order++,
      rounds: [],
    });
    await bumpLibraryUsage(libEx.id);
  }
  document.getElementById("ai-import-modal").classList.remove("open");
  aiImportDraft = null;
  await renderJournal(document.getElementById("journal-search").value);
  alert(`Séance créée avec ${included.length} exercice(s) - il ne te reste plus qu'à la faire.`);
}

// ---------- Synchronisation cloud (voir js/sync.js) ----------

function renderSyncSection() {
  const code = getSyncCode();
  document.getElementById("sync-setup").hidden = !!code;
  document.getElementById("sync-enter-code-field").hidden = true;
  document.getElementById("sync-active").hidden = !code;
  if (code) {
    document.getElementById("sync-code-display").textContent = code;
    const last = getLastSyncLabel();
    document.getElementById("sync-last-label").textContent = last
      ? `Dernière synchro sur cet appareil : ${last}`
      : "Pas encore synchronisé depuis cet appareil.";
  }
}

// Enveloppe un bouton de sync : désactive pendant l'appel (les allers-retours
// réseau prennent un instant), et affiche toute erreur clairement plutôt que
// de rester bloqué en silence - même logique que pour l'ajout d'exercice.
async function withSyncButton(btn, label, fn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try {
    await fn();
  } catch (err) {
    console.error("[carnet-muscu] échec de synchronisation :", err);
    alert(err && err.message ? err.message : "Échec de la synchronisation (vérifie ta connexion).");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
    renderSyncSection();
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

// Outil de diagnostic temporaire (13/09/2026) : Christine a l'impression que
// des exercices favoris disparaissent, et qu'un favori enlevé revient tout
// seul, sans pouvoir ouvrir la console de son téléphone pour vérifier
// elle-même ce qu'il y a réellement dans sa bibliothèque. Affiche à l'écran :
// le nombre réel de favoris, et surtout les doublons de noms (deux
// enregistrements différents pour le même exercice, l'un favori et l'autre
// non, ce qui donnerait exactement l'impression d'un favori qui "revient" -
// on agirait alors sur l'un des deux sans le savoir). À retirer une fois le
// problème élucidé.
// Formate un horodatage en "il y a Xs/min/h" - pour voir d'un coup d'œil si
// un enregistrement vient d'être réécrit (quelques secondes) ou date de
// bien avant le test en cours (plusieurs jours) - ça distingue "quelque
// chose vient de réécrire cette valeur" de "cette valeur n'a en fait jamais
// bougé".
function agoLabel(ts) {
  if (!ts) return "jamais";
  const diffMs = Date.now() - ts;
  const s = Math.round(diffMs / 1000);
  if (s < 60) return `il y a ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m}min`;
  const h = Math.round(m / 60);
  if (h < 48) return `il y a ${h}h`;
  return `il y a ${Math.round(h / 24)}j`;
}

async function diagnoseFavorites() {
  const all = await Db.getAllLibraryExercises();
  const favs = all.filter((ex) => ex.favorite);
  const byName = new Map();
  for (const ex of all) {
    const key = ex.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(ex);
  }
  const dupes = [...byName.values()].filter((group) => group.length > 1);
  const code = typeof getSyncCode === "function" ? getSyncCode() : null;
  let cacheVersion = "inconnue";
  try {
    const keys = await caches.keys();
    cacheVersion = keys.join(", ") || "(aucun cache)";
  } catch (err) {
    // pas grave, juste informatif
  }
  let msg = `Version de l'appli (cache) : ${cacheVersion}\nSynchro cloud : ${code ? "activée" : "désactivée"}${code ? " (dernier envoi : " + (getLastSyncLabel ? getLastSyncLabel() : "?") + ")" : ""}\n\n`;
  msg += `${all.length} exercices au total dans la bibliothèque, dont ${favs.length} en favori.`;
  if (dupes.length > 0) {
    msg += `\n\n⚠️ ${dupes.length} nom(s) en double (deux fiches différentes pour le même exercice) :\n`;
    msg += dupes
      .slice(0, 10)
      .map((group) => `- « ${group[0].name} » : ${group.map((e) => `${e.id} (favori: ${e.favorite ? "oui" : "non"})`).join(" / ")}`)
      .join("\n");
    if (dupes.length > 10) msg += `\n… et ${dupes.length - 10} de plus.`;
  } else {
    msg += "\n\nAucun doublon de nom trouvé.";
  }
  msg += `\n\nFavoris actuels (dernière écriture) :\n${
    favs
      .map((e) => {
        const recent = Db.recentLocalWriteTime ? Db.recentLocalWriteTime(e.id, 3600000) : 0;
        const recentTag = recent ? " [écrit sur cet appareil " + agoLabel(recent) + "]" : "";
        return `- ${e.name} (${e.id}) - MAJ ${agoLabel(e.updatedAt)}, utilisé ${e.usageCount || 0}×${recentTag}`;
      })
      .join("\n") || "(aucun)"
  }`;
  alert(msg);
  console.log("[diagnostic favoris]", { total: all.length, favCount: favs.length, dupes, favs });
}

// Migration ponctuelle (une seule fois par appareil) : les exercices déjà
// utilisés dans une séance AVANT ce correctif (comme "Hip Thrust" chez
// Christine) n'avaient jamais été marqués favoris automatiquement - ils
// disparaissaient donc de la modale d'ajout, filtrée par défaut sur les
// favoris. On les rattrape ici une fois pour toutes.
async function migrateFavoritesForAlreadyUsedExercises() {
  const FLAG = "carnet-muscu-migrated-fav-used-v1";
  if (localStorage.getItem(FLAG)) return;
  try {
    const all = await Db.getAllLibraryExercises();
    for (const ex of all) {
      if ((ex.usageCount || 0) > 0 && !ex.favorite) {
        ex.favorite = true;
        await Db.updateLibraryExercise(ex);
      }
    }
  } catch (err) {
    console.error("[carnet-muscu] échec de la migration des favoris :", err);
  }
  localStorage.setItem(FLAG, "1");
}

// Corrige une fois pour toutes les compteurs "utilisé X×" déjà faussés par
// l'ancien système (incrémenté à l'ajout, jamais corrigé si on changeait
// d'exercice ou le supprimait avant d'avoir fait un tour - voir
// recomputeLibraryUsageCount ci-dessus). Exemple réel signalé par Christine :
// "Band bent-over hip extension" marqué utilisé alors qu'elle ne l'avait
// jamais réellement fait. Recalcule tout depuis les vraies exerciseSessions,
// une seule fois par appareil (comme migrateFavoritesForAlreadyUsedExercises).
// -v2 (14/09/2026) : mergeBackupData() écrasait ce compteur avec la valeur
// reçue d'un autre appareil ou d'une vieille sauvegarde cloud, sans jamais
// le recalculer - un compteur faux pouvait donc revenir après une synchro
// même une fois corrigé ici (cas réel : "Kettlebell alternating renegade
// row" marqué utilisé alors qu'absent de Progrès et de toute séance). La
// synchro est corrigée séparément pour ne plus jamais recopier ce champ tel
// quel ; ce -v2 fait tourner une dernière fois ce recalcul général pour
// rattraper les compteurs déjà faussés sur cet appareil avant ce correctif.
async function migrateUsageCountsFromRealData() {
  const FLAG = "carnet-muscu-migrated-usage-recompute-v2";
  if (localStorage.getItem(FLAG)) return;
  try {
    const allExerciseSessions = await Db.getAllExerciseSessions();
    const counts = new Map();
    for (const es of allExerciseSessions) {
      if (!es.libraryExerciseId) continue;
      counts.set(es.libraryExerciseId, (counts.get(es.libraryExerciseId) || 0) + 1);
    }
    const all = await Db.getAllLibraryExercises();
    for (const ex of all) {
      const real = counts.get(ex.id) || 0;
      if ((ex.usageCount || 0) !== real) {
        ex.usageCount = real;
        await Db.updateLibraryExercise(ex);
      }
    }
  } catch (err) {
    console.error("[carnet-muscu] échec de la migration des compteurs d'utilisation :", err);
  }
  localStorage.setItem(FLAG, "1");
}

// Récupère une photo partagée depuis une autre appli (WhatsApp, galerie...) -
// voir le "share_target" dans manifest.json et handleSharedPhoto dans sw.js,
// qui a intercepté l'envoi avant qu'il n'atteigne le serveur (impossible sur
// un hébergement statique comme GitHub Pages) et a mis la photo de côté dans
// un cache. On ouvre alors directement l'import IA avec cette photo, comme
// si Christine avait choisi le fichier elle-même.
//
// Deux façons d'arriver ici, TOUTES LES DEUX nécessaires (constaté avec
// Christine le 14/09/2026 : le partage ouvrait bien l'appli, mais jamais
// l'import) :
// 1) L'appli n'était pas ouverte (ou Android en lance une nouvelle instance) :
//    une vraie navigation se fait vers index.html?photo-partagee=1 (le
//    redirect fait par handleSharedPhoto), et checkForSharedPhoto() ci-dessous
//    la détecte au chargement de la page.
// 2) L'appli était DÉJÀ ouverte en arrière-plan : Android/Chrome se contente
//    alors souvent de ramener cette fenêtre déjà existante au premier plan
//    SANS jamais lui faire charger cette URL - la méthode 1) ne se déclenche
//    donc jamais. sw.js prévient dans ce cas directement la page ouverte par
//    un message (postMessage), écouté plus bas sur navigator.serviceWorker.
async function consumeSharedPhotoFromCache() {
  if (!("caches" in window)) return;
  try {
    const cache = await caches.open("carnet-muscu-shared-photo");
    const response = await cache.match("photo");
    if (!response) return;
    await cache.delete("photo");
    const blob = await response.blob();
    const file = new File([blob], "photo-partagee.jpg", { type: blob.type || "image/jpeg" });
    await openAiImportFlow(file);
  } catch (err) {
    console.error("[carnet-muscu] échec de la récupération de la photo partagée :", err);
  }
}

async function checkForSharedPhoto() {
  if (!location.search.includes("photo-partagee=1")) return;
  // Nettoie l'URL tout de suite, avant même de savoir si une photo est
  // effectivement présente, pour ne jamais redéclencher ça au prochain
  // rechargement de la page (ex. après avoir remis l'appli au premier plan).
  window.history.replaceState({}, "", location.pathname);
  await consumeSharedPhotoFromCache();
}

// Cas 2) ci-dessus : l'appli était déjà ouverte, sw.js le signale directement
// via un message plutôt que par une navigation (voir handleSharedPhoto).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data && event.data.type === "carnet-muscu-shared-photo") {
      consumeSharedPhotoFromCache();
    }
  });
}

async function init() {
  await Db.init();
  await migrateFavoritesForAlreadyUsedExercises();
  await migrateUsageCountsFromRealData();
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
    const affectedIds = (await Db.getExerciseSessionsForSession(currentSessionId)).map((e) => e.libraryExerciseId).filter(Boolean);
    await Db.deleteSession(currentSessionId);
    for (const id of new Set(affectedIds)) await recomputeLibraryUsageCount(id);
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
  on("diagnose-fav-btn", "click", diagnoseFavorites);
  on("export-btn", "click", exportSessions);
  on("import-btn", "click", () => {
    document.getElementById("import-file-input").click();
  });
  on("import-file-input", "change", async (e) => {
    const file = e.target.files[0];
    e.target.value = ""; // pour pouvoir réimporter le même fichier plus tard si besoin
    if (file) await importBackup(file);
  });
  // Import de séance depuis une photo, lue par IA (voir js/ai.js) - toujours
  // un brouillon à valider avant enregistrement (demande de Christine du
  // 12/09/2026).
  on("ai-import-cta", "click", () => {
    document.getElementById("ai-import-file-input").click();
  });
  on("ai-import-file-input", "change", async (e) => {
    const file = e.target.files[0];
    e.target.value = ""; // pour pouvoir réimporter la même photo plus tard si besoin
    if (file) await openAiImportFlow(file);
  });
  on("close-ai-import-modal-btn", "click", () => {
    document.getElementById("ai-import-modal").classList.remove("open");
    aiImportDraft = null;
  });
  on("ai-import-cancel-btn", "click", () => {
    document.getElementById("ai-import-modal").classList.remove("open");
    aiImportDraft = null;
  });
  on("ai-import-confirm-btn", "click", confirmAiImport);
  on("ai-import-tours-minus", "click", () => stepAiImportTours(-1));
  on("ai-import-tours-plus", "click", () => stepAiImportTours(1));
  // La synchronisation est maintenant dans une modale (bouton ⇅ en haut à
  // droite du journal) plutôt qu'affichée en permanence à l'écran, à la
  // demande de Christine ("c'est trop présent").
  on("open-sync-modal-btn", "click", () => {
    renderSyncSection();
    document.getElementById("sync-modal").classList.add("open");
  });
  on("close-sync-modal-btn", "click", () => {
    document.getElementById("sync-modal").classList.remove("open");
  });
  // Graphique "séances par mois" (à la demande de Christine, en cliquant sur
  // la tuile correspondante du journal).
  on("stat-month-tile", "click", openSessionsPerMonthChart);
  on("close-sessions-chart-btn", "click", () => {
    document.getElementById("sessions-chart-modal").classList.remove("open");
  });
  // Synchro automatique dès qu'un code est déjà configuré au chargement de
  // l'appli (à la demande de Christine : "toujours à jour", en temps réel,
  // tant que l'appli est ouverte au premier plan - voir js/sync.js).
  if (getSyncCode()) {
    Db._onWrite = scheduleAutoPush;
    startRealtimeSync();
  }
  renderSyncSection();
  on("sync-create-code-btn", "click", async () => {
    setSyncCode(generateSyncCode());
    Db._onWrite = scheduleAutoPush;
    startRealtimeSync();
    renderSyncSection();
    // Envoi immédiat des données déjà présentes sur cet appareil, pour que
    // l'autre appareil trouve tout de suite quelque chose en collant le code
    // - avant, il fallait cliquer manuellement sur "Sauvegarder".
    try {
      await pushBackupToCloud();
      renderSyncSection();
    } catch (err) {
      console.error("[carnet-muscu] échec de l'envoi initial :", err);
    }
    alert("Code créé et tes données envoyées dans le cloud. Colle ce code dans « J'ai déjà un code » sur ton autre appareil : la synchronisation se fera ensuite automatiquement, tant que l'appli est ouverte sur les deux appareils.");
  });
  on("sync-enter-code-btn", "click", () => {
    document.getElementById("sync-code-input").value = "";
    document.getElementById("sync-enter-code-field").hidden = false;
    document.getElementById("sync-code-input").focus();
  });
  on("sync-cancel-code-btn", "click", () => {
    document.getElementById("sync-enter-code-field").hidden = true;
  });
  on("sync-confirm-code-btn", "click", () => {
    const code = document.getElementById("sync-code-input").value.trim();
    if (!code) return;
    setSyncCode(code);
    Db._onWrite = scheduleAutoPush;
    startRealtimeSync();
    renderSyncSection();
  });
  on("sync-copy-code-btn", "click", async () => {
    const code = getSyncCode();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      alert("Code copié.");
    } catch {
      prompt("Copie ce code manuellement :", code);
    }
  });
  on("sync-push-btn", "click", (e) => withSyncButton(e.target, "Envoi…", async () => {
    await pushBackupToCloud();
    alert("Sauvegarde envoyée dans le cloud.");
  }));
  on("sync-pull-btn", "click", (e) => withSyncButton(e.target, "Récupération…", async () => {
    const r = await pullBackupFromCloud();
    alert(`Récupération terminée : ${r.sessionCount} séance(s) et ${r.libraryCount} exercice(s) de bibliothèque mis à jour.`);
  }));
  on("sync-forget-btn", "click", () => {
    if (!confirm("Oublier ce code de synchronisation sur cet appareil ? Tes données locales ne sont pas touchées, mais cet appareil ne se synchronisera plus tant que tu n'auras pas remis un code.")) return;
    forgetSyncCode();
    renderSyncSection();
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
  await checkForSharedPhoto();
}

document.addEventListener("DOMContentLoaded", init);

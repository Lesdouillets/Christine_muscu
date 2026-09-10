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
  if (viewName === "journal") document.getElementById("nav-journal").classList.add("sel");
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
    const card = document.createElement("button");
    card.className = "session-card";
    card.innerHTML = `
      <div class="session-top">
        <span class="session-date">${formatDateFr(s.date)}</span>
        <span class="session-meta">${exs.length} exercice${exs.length > 1 ? "s" : ""}</span>
      </div>
      <div class="session-title">${escapeHtml(s.title)}</div>
    `;
    card.addEventListener("click", () => openSession(s.id));
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
  document.getElementById("stat-record").textContent = "—"; // calcul détaillé prévu en phase "progrès"
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
  document.getElementById("new-session-tours").value = 1;
  goTo("new-session");
}

async function createSession() {
  const title = document.getElementById("new-session-title").value.trim() || "Séance";
  const date = document.getElementById("new-session-date").value || todayIso();
  const tours = Math.max(1, parseInt(document.getElementById("new-session-tours").value, 10) || 1);
  const session = await Db.addSession({ date, title, tours });
  openSession(session.id);
}

// ---------- Écran séance ----------

async function openSession(sessionId) {
  currentSessionId = sessionId;
  const session = await Db.getSession(sessionId);
  document.getElementById("session-title-display").textContent = session.title;
  document.getElementById("session-date-display").textContent = formatDateFr(session.date);
  await renderExerciseList();
  goTo("session");
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

  const head = document.createElement("button");
  head.className = "acc-head";
  head.innerHTML = `
    <div class="acc-head-main">
      <span class="acc-name">${escapeHtml(ex.name)}</span>
      <span class="acc-sub">${ex.targetReps} reps · ${typeLabel(ex.type)}</span>
    </div>
    <div class="acc-right">
      <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
    </div>
  `;
  head.addEventListener("click", () => {
    const wasOpen = item.classList.contains("open");
    document.querySelectorAll(".acc-item.open").forEach((i) => i.classList.remove("open"));
    if (!wasOpen) item.classList.add("open");
  });

  const panel = document.createElement("div");
  panel.className = "acc-panel";
  const body = document.createElement("div");
  body.className = "acc-body";

  // gif (placeholder tant que la bibliothèque de gifs n'est pas branchée - phase 2)
  const gifRow = document.createElement("div");
  gifRow.className = "gif-row";
  gifRow.innerHTML = `
    <div class="gif-thumb"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>
    <div class="gif-meta"><span class="t">démonstration à venir (phase 2)</span></div>
  `;
  body.appendChild(gifRow);

  // historique
  if (last) {
    const lastWeightTxt = weightLabel(ex.type, roundWeight(last, 0));
    const lastFeeling = feelingLabel(roundFeeling(last, 0));
    const histo = document.createElement("div");
    histo.className = "history-line";
    histo.innerHTML = `Dernière fois - <b>${lastWeightTxt}</b>${lastFeeling ? `, noté « ${lastFeeling} »` : ""}.`;
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

  panel.appendChild(body);
  item.appendChild(head);
  item.appendChild(panel);
  return item;
}

function typeLabel(type) {
  return { barre: "barre", halteres: "haltères", poids_du_corps: "poids du corps", inconnu: "à classer" }[type] || type;
}
function feelingLabel(f) {
  return { light: "trop léger", good: "bien", heavy: "trop lourd" }[f] || "";
}
function roundWeight(ex, i) {
  return (ex.rounds && ex.rounds[i] && ex.rounds[i].weight) || null;
}
function roundFeeling(ex, i) {
  return (ex.rounds && ex.rounds[i] && ex.rounds[i].feeling) || null;
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

  if (ex.type === "poids_du_corps") {
    const note = document.createElement("div");
    note.className = "bodyweight-note";
    note.textContent = "Poids du corps - pas de charge à saisir.";
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
    });
  });
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

  if (ex.type !== "poids_du_corps") {
    const chip = document.createElement("button");
    chip.className = "rc-weight";
    const w = roundWeight(ex, index) || roundWeight(ex, index - 1) || roundWeight(ex, 0);
    chip.textContent = (w ? weightLabel(ex.type, w) : "définir le poids") + " ✎";
    chip.addEventListener("click", async () => {
      const current = roundWeight(ex, index) || roundWeight(ex, index - 1) || roundWeight(ex, 0);
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

// ---------- Ajouter un exercice à une séance ----------

let newExerciseReps = 10;
let newExerciseName = "";

function openExerciseModal() {
  document.getElementById("exercise-search-input").value = "";
  document.getElementById("exercise-search-results").innerHTML = "";
  document.getElementById("new-exercise-form").hidden = true;
  newExerciseReps = 10;
  newExerciseName = "";
  document.getElementById("new-exercise-reps-value").textContent = "10";
  document.getElementById("exercise-modal").classList.add("open");
  document.getElementById("exercise-search-input").focus();
}
function closeExerciseModal() {
  document.getElementById("exercise-modal").classList.remove("open");
}

async function searchExercisesInModal(query) {
  const q = query.trim();
  document.getElementById("new-exercise-form").hidden = true;
  const results = await Db.searchLibraryExercises(q);
  const resultsEl = document.getElementById("exercise-search-results");
  resultsEl.innerHTML = "";

  for (const r of results.slice(0, 8)) {
    const div = document.createElement("div");
    div.className = "result-item";
    div.textContent = `${r.name} (${typeLabel(r.type)})`;
    div.addEventListener("click", () => addExerciseToSession(r));
    resultsEl.appendChild(div);
  }

  const exactMatch = results.some((r) => r.name.toLowerCase() === q.toLowerCase());
  if (q && !exactMatch) {
    const addNew = document.createElement("div");
    addNew.className = "result-item result-item-new";
    addNew.textContent = `+ ajouter « ${q} » comme nouvel exercice`;
    addNew.addEventListener("click", () => openNewExerciseForm(q));
    resultsEl.appendChild(addNew);
  }
}

function openNewExerciseForm(name) {
  newExerciseName = name;
  newExerciseReps = 10;
  document.getElementById("new-exercise-name-display").textContent = name;
  document.getElementById("new-exercise-reps-value").textContent = "10";
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
  closeExerciseModal();
  await renderExerciseList();
}

async function confirmAddExerciseFromModal() {
  if (!newExerciseName) return;
  const type = document.getElementById("new-exercise-type").value;
  const libEx = await Db.addLibraryExercise({ name: newExerciseName, type, gif: null });
  await addExerciseToSession(libEx, newExerciseReps);
}

// ---------- Export ----------

async function exportSessions() {
  const sessions = await Db.getAllSessions();
  const full = [];
  for (const s of sessions) {
    const exs = await Db.getExerciseSessionsForSession(s.id);
    full.push({ ...s, exercises: exs });
  }
  const blob = new Blob([JSON.stringify(full, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `carnet-musculation-export-${todayIso()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Câblage des événements et démarrage ----------

async function init() {
  await Db.init();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  document.getElementById("nav-journal").addEventListener("click", async () => {
    await renderJournal();
    goTo("journal");
  });
  document.getElementById("nav-add").addEventListener("click", openNewSessionForm);
  document.querySelectorAll("[data-go='journal']").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await renderJournal();
      goTo("journal");
    })
  );
  document.getElementById("create-session-btn").addEventListener("click", createSession);
  document.getElementById("add-exercise-btn").addEventListener("click", openExerciseModal);
  document.getElementById("cancel-add-exercise-btn").addEventListener("click", closeExerciseModal);
  document.getElementById("confirm-add-exercise-btn").addEventListener("click", confirmAddExerciseFromModal);
  document.getElementById("exercise-search-input").addEventListener("input", (e) =>
    searchExercisesInModal(e.target.value)
  );
  document.getElementById("new-exercise-reps-minus").addEventListener("click", () => {
    newExerciseReps = Math.max(1, newExerciseReps - 1);
    document.getElementById("new-exercise-reps-value").textContent = newExerciseReps;
  });
  document.getElementById("new-exercise-reps-plus").addEventListener("click", () => {
    newExerciseReps = newExerciseReps + 1;
    document.getElementById("new-exercise-reps-value").textContent = newExerciseReps;
  });
  document.getElementById("journal-search").addEventListener("input", (e) => renderJournal(e.target.value));
  document.getElementById("export-btn").addEventListener("click", exportSessions);

  await renderJournal();
}

document.addEventListener("DOMContentLoaded", init);

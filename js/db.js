// Petit wrapper IndexedDB. Toutes les données restent sur le téléphone
// (aucun réseau, aucun compte) - voir spec section 3.
//
// Schéma :
//   sessions      { id, date (ISO), title, tours (nombre), exerciseIds: [exerciseSessionId, ...] }
//   exerciseSessions { id, sessionId, libraryExerciseId, name, targetReps, type, order,
//                      rounds: [{ round, weight: {..}|null, feeling: 'light'|'good'|'heavy'|null }] }
//   library       { id, name, type: 'barre'|'halteres'|'poids_du_corps'|'inconnu', gif: {kind:'link'|'file', value} }

const DB_NAME = "carnet-muscu";
// v2 (13/09/2026) : ajoute le magasin "libraryTombstones" - voir le
// commentaire au-dessus de deleteLibraryExercise plus bas pour le bug que ça
// corrige (un exercice supprimé, y compris un doublon, qui revenait tout
// seul à la prochaine synchro).
const DB_VERSION = 2;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("sessions")) {
        const s = db.createObjectStore("sessions", { keyPath: "id" });
        s.createIndex("date", "date");
      }
      if (!db.objectStoreNames.contains("exerciseSessions")) {
        const es = db.createObjectStore("exerciseSessions", { keyPath: "id" });
        es.createIndex("sessionId", "sessionId");
        es.createIndex("libraryExerciseId", "libraryExerciseId");
      }
      if (!db.objectStoreNames.contains("library")) {
        const lib = db.createObjectStore("library", { keyPath: "id" });
        lib.createIndex("name", "name");
      }
      if (!db.objectStoreNames.contains("libraryTombstones")) {
        // Garde une trace de chaque exercice de bibliothèque supprimé
        // (id + date de suppression), pour que la synchro cloud sache qu'il
        // a été supprimé ICI et ne le réimporte pas depuis un autre appareil
        // (ou depuis le cloud lui-même) à la synchro suivante.
        db.createObjectStore("libraryTombstones", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, storeNames, mode) {
  return db.transaction(storeNames, mode);
}

function uid() {
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9)
  );
}

// Garde-fou anti-régression pour la synchro (13/09/2026) : Christine a vu un
// favori qu'elle venait d'enlever redevenir favori quelques secondes plus
// tard, pile au moment où l'envoi automatique vers le cloud se déclenche
// (voir scheduleAutoPush, js/sync.js - délai de 4s). On retient ici, en
// mémoire, l'horodatage exact de la dernière écriture DIRECTE (faite par
// Christine sur cet appareil, pas une écriture de fusion) pour chaque
// enregistrement. mergeBackupData (js/app.js) compare l'horodatage reçu à
// CET horodatage-ci en plus de celui lu en base, plutôt qu'à la seule
// valeur relue depuis IndexedDB juste après - ça couvre le cas où la
// lecture et la fusion s'entremêlent d'une façon qui ferait perdre la
// comparaison normale. Un enregistrement vraiment plus récent venu d'un
// autre appareil continue d'être appliqué normalement (voir l'usage dans
// mergeBackupData : on prend le plus récent des deux horodatages connus,
// pas un simple blocage total). Volontairement en mémoire seulement (pas
// persistant) : protection à très court terme, pas un système de fusion à
// part entière.
const _recentLocalWrites = new Map(); // id -> timestamp de la dernière écriture locale directe
function _markRecentLocalWrite(id) {
  _recentLocalWrites.set(id, Date.now());
  if (_recentLocalWrites.size > 500) {
    const cutoff = Date.now() - 60000;
    for (const [k, t] of _recentLocalWrites) {
      if (t < cutoff) _recentLocalWrites.delete(k);
    }
  }
}

const Db = {
  // Point d'accroche pour la synchronisation cloud automatique (voir
  // js/sync.js) : app.js branche ici une fonction appelée après chaque
  // écriture "utile" (séances, exercices de bibliothèque), pour déclencher
  // un envoi automatique vers le cloud sans que Christine ait à cliquer sur
  // un bouton. Reste `null` tant qu'aucun code de synchronisation n'est
  // configuré. Volontairement absent de bulkAddLibraryExercises : l'import
  // initial du catalogue (1300+ exercices) ne doit jamais déclencher d'envoi
  // au cloud (voir buildCloudSyncPayload dans sync.js, qui l'exclut de toute
  // façon, mais autant ne pas programmer un envoi inutile).
  _onWrite: null,
  _notifyWrite() {
    if (this._onWrite) {
      try {
        this._onWrite();
      } catch (err) {
        console.error("[carnet-muscu] hook de synchro en échec :", err);
      }
    }
  },

  async init() {
    this._db = await openDb();
    return this._db;
  },

  // Horodatage de la dernière écriture DIRECTE de `id` sur cet appareil, si
  // elle date de moins de `windowMs` (voir le commentaire sur
  // _recentLocalWrites plus haut), sinon 0. mergeBackupData compare
  // l'enregistrement reçu au PLUS RÉCENT de cet horodatage et de celui lu en
  // base - jamais un blocage total : un enregistrement reçu réellement plus
  // récent est quand même appliqué normalement.
  recentLocalWriteTime(id, windowMs = 15000) {
    const t = _recentLocalWrites.get(id);
    return t && Date.now() - t < windowMs ? t : 0;
  },

  async addSession(session) {
    const db = this._db;
    const record = { id: uid(), updatedAt: Date.now(), ...session };
    await new Promise((resolve, reject) => {
      const t = tx(db, ["sessions"], "readwrite");
      t.objectStore("sessions").add(record);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    _markRecentLocalWrite(record.id);
    this._notifyWrite();
    return record;
  },

  // `opts.preserveTimestamp` : utilisé UNIQUEMENT par la fusion de synchro
  // (mergeBackupData, js/app.js) pour réappliquer un enregistrement déjà
  // reçu d'un autre appareil sans écraser son horodatage d'origine par
  // "maintenant" - cet horodatage est ce qui permet de départager deux
  // versions divergentes de la même séance lors d'une prochaine fusion (voir
  // la robustesse de la synchro, demandée par Christine le 12/09/2026). Un
  // vrai changement fait ICI, sur cet appareil (renommer, changer le nombre
  // de tours...), doit toujours obtenir un horodatage frais - c'est le
  // comportement par défaut, sans avoir besoin de le préciser à chaque appel.
  async updateSession(session, opts = {}) {
    const db = this._db;
    const record = opts.preserveTimestamp ? session : { ...session, updatedAt: Date.now() };
    await new Promise((resolve, reject) => {
      const t = tx(db, ["sessions"], "readwrite");
      t.objectStore("sessions").put(record);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    if (!opts.preserveTimestamp) _markRecentLocalWrite(record.id);
    this._notifyWrite();
  },

  async getAllSessions() {
    const db = this._db;
    return new Promise((resolve, reject) => {
      const t = tx(db, ["sessions"], "readonly");
      const req = t.objectStore("sessions").getAll();
      req.onsuccess = () =>
        resolve(req.result.sort((a, b) => (a.date < b.date ? 1 : -1)));
      req.onerror = () => reject(req.error);
    });
  },

  async getSession(id) {
    const db = this._db;
    return new Promise((resolve, reject) => {
      const t = tx(db, ["sessions"], "readonly");
      const req = t.objectStore("sessions").get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async addExerciseSession(exerciseSession) {
    const db = this._db;
    const record = { id: uid(), updatedAt: Date.now(), ...exerciseSession };
    await new Promise((resolve, reject) => {
      const t = tx(db, ["exerciseSessions"], "readwrite");
      t.objectStore("exerciseSessions").add(record);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    _markRecentLocalWrite(record.id);
    this._notifyWrite();
    return record;
  },

  // Voir le commentaire sur `opts.preserveTimestamp` au niveau de
  // updateSession ci-dessus - même principe ici.
  async updateExerciseSession(exerciseSession, opts = {}) {
    const db = this._db;
    const record = opts.preserveTimestamp ? exerciseSession : { ...exerciseSession, updatedAt: Date.now() };
    await new Promise((resolve, reject) => {
      const t = tx(db, ["exerciseSessions"], "readwrite");
      t.objectStore("exerciseSessions").put(record);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    if (!opts.preserveTimestamp) _markRecentLocalWrite(record.id);
    this._notifyWrite();
  },

  // Retire un seul exercice d'une séance (contrairement à deleteSession qui
  // supprime la séance entière) - à la demande de Christine ("pouvoir
  // supprimer ou modifier un exo mis dans une séance").
  async deleteExerciseSession(id) {
    const db = this._db;
    await new Promise((resolve, reject) => {
      const t = tx(db, ["exerciseSessions"], "readwrite");
      t.objectStore("exerciseSessions").delete(id);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    this._notifyWrite();
  },

  async deleteSession(sessionId) {
    const db = this._db;
    const exs = await this.getExerciseSessionsForSession(sessionId);
    await new Promise((resolve, reject) => {
      const t = tx(db, ["sessions", "exerciseSessions"], "readwrite");
      t.objectStore("sessions").delete(sessionId);
      const esStore = t.objectStore("exerciseSessions");
      for (const ex of exs) esStore.delete(ex.id);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    this._notifyWrite();
  },

  // Tout l'historique d'un exercice de bibliothèque donné, toutes séances
  // confondues (sert à l'onglet "Progrès" - graphique d'évolution).
  async getExerciseSessionsByLibraryId(libraryExerciseId) {
    const db = this._db;
    return new Promise((resolve, reject) => {
      const t = tx(db, ["exerciseSessions"], "readonly");
      const idx = t.objectStore("exerciseSessions").index("libraryExerciseId");
      const req = idx.getAll(libraryExerciseId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  // Toutes les entrées d'exercice, toutes séances confondues (sert à
  // construire la liste "quels exercices ont un historique" - onglet Progrès).
  async getAllExerciseSessions() {
    const db = this._db;
    return new Promise((resolve, reject) => {
      const t = tx(db, ["exerciseSessions"], "readonly");
      const req = t.objectStore("exerciseSessions").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  // Un seul exercice de séance par son id (sert à la fusion de synchro pour
  // comparer les horodatages avant d'écraser - voir mergeBackupData, js/app.js).
  async getExerciseSession(id) {
    const db = this._db;
    return new Promise((resolve, reject) => {
      const t = tx(db, ["exerciseSessions"], "readonly");
      const req = t.objectStore("exerciseSessions").get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async getExerciseSessionsForSession(sessionId) {
    const db = this._db;
    return new Promise((resolve, reject) => {
      const t = tx(db, ["exerciseSessions"], "readonly");
      const idx = t.objectStore("exerciseSessions").index("sessionId");
      const req = idx.getAll(sessionId);
      req.onsuccess = () =>
        resolve(req.result.sort((a, b) => a.order - b.order));
      req.onerror = () => reject(req.error);
    });
  },

  // Dernier passage sur un exercice de bibliothèque donné, avant une date donnée
  // (sert à la ligne d'historique "dernière fois : ..." - spec section 6).
  async getLastExerciseSession(libraryExerciseId, beforeSessionId) {
    const db = this._db;
    const all = await new Promise((resolve, reject) => {
      const t = tx(db, ["exerciseSessions"], "readonly");
      const idx = t.objectStore("exerciseSessions").index("libraryExerciseId");
      const req = idx.getAll(libraryExerciseId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const others = all.filter((e) => e.sessionId !== beforeSessionId);
    if (others.length === 0) return null;
    // trié par date de séance décroissante
    const sessions = await this.getAllSessions();
    const dateOf = (sId) => (sessions.find((s) => s.id === sId) || {}).date;
    others.sort((a, b) => (dateOf(a.sessionId) < dateOf(b.sessionId) ? 1 : -1));
    return others[0];
  },

  async addLibraryExercise(exercise) {
    const db = this._db;
    const record = { id: uid(), updatedAt: Date.now(), ...exercise };
    await new Promise((resolve, reject) => {
      const t = tx(db, ["library"], "readwrite");
      t.objectStore("library").add(record);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    _markRecentLocalWrite(record.id);
    this._notifyWrite();
    return record;
  },

  async getAllLibraryExercises() {
    const db = this._db;
    return new Promise((resolve, reject) => {
      const t = tx(db, ["library"], "readonly");
      const req = t.objectStore("library").getAll();
      req.onsuccess = () =>
        resolve(req.result.sort((a, b) => a.name.localeCompare(b.name, "fr")));
      req.onerror = () => reject(req.error);
    });
  },

  async searchLibraryExercises(query) {
    const all = await this.getAllLibraryExercises();
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((e) => e.name.toLowerCase().includes(q));
  },

  // Voir le commentaire sur `opts.preserveTimestamp` au niveau de
  // updateSession plus haut - même principe ici.
  async updateLibraryExercise(exercise, opts = {}) {
    const db = this._db;
    const record = opts.preserveTimestamp ? exercise : { ...exercise, updatedAt: Date.now() };
    await new Promise((resolve, reject) => {
      const t = tx(db, ["library"], "readwrite");
      t.objectStore("library").put(record);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    if (!opts.preserveTimestamp) _markRecentLocalWrite(record.id);
    this._notifyWrite();
  },

  async getLibraryExercise(id) {
    const db = this._db;
    return new Promise((resolve, reject) => {
      const t = tx(db, ["library"], "readonly");
      const req = t.objectStore("library").get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  // Supprime un exercice de la bibliothèque (à la demande de Christine, pour
  // nettoyer des exercices créés par erreur ou en double). L'historique des
  // séances passées n'est pas touché : chaque exerciseSession garde son
  // propre name/type déjà enregistrés, donc rien ne disparaît des séances
  // déjà faites - seul le lien vers cet exercice de bibliothèque est perdu.
  //
  // Pose aussi une "tombe" (libraryTombstones) - correctif du 13/09/2026 :
  // la synchro (mergeBackupData, js/app.js) ne fait qu'ajouter/mettre à jour,
  // jamais supprimer ("un import ne supprime jamais rien" - volontaire pour
  // ne jamais perdre une séance). Sans cette tombe, un exercice supprimé ici
  // revenait donc tout seul dès la synchro suivante : soit parce qu'il était
  // encore dans le document cloud (jamais informé de la suppression), soit
  // parce qu'un autre appareil le renvoyait. La tombe dit explicitement à la
  // fusion "cet id a été supprimé ici à telle date, ne le réimporte pas" -
  // exactement le souci que Christine a rencontré en nettoyant des doublons
  // (ex. Back squat).
  async deleteLibraryExercise(id) {
    const db = this._db;
    const deletedAt = Date.now();
    await new Promise((resolve, reject) => {
      const t = tx(db, ["library", "libraryTombstones"], "readwrite");
      t.objectStore("library").delete(id);
      t.objectStore("libraryTombstones").put({ id, deletedAt });
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    _markRecentLocalWrite(id);
    this._notifyWrite();
  },

  // Supprime uniquement l'enregistrement de bibliothèque, sans poser de
  // tombe ni marquer d'écriture locale récente - réservé à mergeBackupData
  // qui applique une tombe REÇUE d'ailleurs (voir recordLibraryTombstone) :
  // la tombe elle-même garde alors la date d'origine de la suppression, pas
  // "maintenant" sur cet appareil.
  async deleteLibraryExerciseRecordOnly(id) {
    const db = this._db;
    await new Promise((resolve, reject) => {
      const t = tx(db, ["library"], "readwrite");
      t.objectStore("library").delete(id);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    this._notifyWrite();
  },

  async getAllLibraryTombstones() {
    const db = this._db;
    return new Promise((resolve, reject) => {
      const t = tx(db, ["libraryTombstones"], "readonly");
      const req = t.objectStore("libraryTombstones").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async getLibraryTombstone(id) {
    const db = this._db;
    return new Promise((resolve, reject) => {
      const t = tx(db, ["libraryTombstones"], "readonly");
      const req = t.objectStore("libraryTombstones").get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  // Enregistre (ou met à jour) une tombe reçue d'ailleurs (fichier importé ou
  // cloud) - ne réécrit jamais avec une date plus ancienne que celle déjà
  // connue ici, comme pour tout le reste de la fusion.
  async recordLibraryTombstone(id, deletedAt) {
    const db = this._db;
    const existing = await this.getLibraryTombstone(id);
    if (existing && existing.deletedAt >= deletedAt) return;
    await new Promise((resolve, reject) => {
      const t = tx(db, ["libraryTombstones"], "readwrite");
      t.objectStore("libraryTombstones").put({ id, deletedAt });
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  },

  async countLibraryExercises() {
    const db = this._db;
    return new Promise((resolve, reject) => {
      const t = tx(db, ["library"], "readonly");
      const req = t.objectStore("library").count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  // Import en masse (bibliothèque publique importée une seule fois au premier
  // lancement - section "Phase 2" du plan). Chaque enregistrement garde l'id
  // du jeu de données comme clé, préfixé pour ne jamais entrer en collision
  // avec un exercice créé à la main (uid() ne génère jamais ce préfixe).
  async bulkAddLibraryExercises(records) {
    const db = this._db;
    await new Promise((resolve, reject) => {
      const t = tx(db, ["library"], "readwrite");
      const store = t.objectStore("library");
      for (const r of records) store.put(r);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  },
};

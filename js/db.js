// Petit wrapper IndexedDB. Toutes les données restent sur le téléphone
// (aucun réseau, aucun compte) - voir spec section 3.
//
// Schéma :
//   sessions      { id, date (ISO), title, tours (nombre), exerciseIds: [exerciseSessionId, ...] }
//   exerciseSessions { id, sessionId, libraryExerciseId, name, targetReps, type, order,
//                      rounds: [{ round, weight: {..}|null, feeling: 'light'|'good'|'heavy'|null }] }
//   library       { id, name, type: 'barre'|'halteres'|'poids_du_corps'|'inconnu', gif: {kind:'link'|'file', value} }

const DB_NAME = "carnet-muscu";
const DB_VERSION = 1;

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

const Db = {
  async init() {
    this._db = await openDb();
    return this._db;
  },

  async addSession(session) {
    const db = this._db;
    const record = { id: uid(), ...session };
    await new Promise((resolve, reject) => {
      const t = tx(db, ["sessions"], "readwrite");
      t.objectStore("sessions").add(record);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    return record;
  },

  async updateSession(session) {
    const db = this._db;
    await new Promise((resolve, reject) => {
      const t = tx(db, ["sessions"], "readwrite");
      t.objectStore("sessions").put(session);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
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
    const record = { id: uid(), ...exerciseSession };
    await new Promise((resolve, reject) => {
      const t = tx(db, ["exerciseSessions"], "readwrite");
      t.objectStore("exerciseSessions").add(record);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    return record;
  },

  async updateExerciseSession(exerciseSession) {
    const db = this._db;
    await new Promise((resolve, reject) => {
      const t = tx(db, ["exerciseSessions"], "readwrite");
      t.objectStore("exerciseSessions").put(exerciseSession);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
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
    const record = { id: uid(), ...exercise };
    await new Promise((resolve, reject) => {
      const t = tx(db, ["library"], "readwrite");
      t.objectStore("library").add(record);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
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
};

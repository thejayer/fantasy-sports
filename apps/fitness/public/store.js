// Single source of truth for mutable app state.
//
// What lives here: the 10 state slices listed in COM-150 — sessions,
// plannedSessions, recovery, customDrills, readinessCheckins, athleteProfile,
// activeGoalId, activeProgramId, golfClubBag, gpsRound.
//
// What does NOT live here: UI-transient state (editingSessionId, calendarCursor,
// installPromptEvent), static catalogs in data.js (sessionTemplates, goals,
// programBlueprints, golfGpsCourse, etc.), and shape normalizers (still in app.js
// where they're shared with events.js for the import flow).
//
// API (see COM-150 acceptance criteria):
//   store.init({ values, persist }, mirrorFn?)  - one-time seed from app.js
//   store.getState()                            - frozen snapshot (slices frozen one level deep)
//   store.subscribe(listener)                   - unsubscribe via returned fn
//   store.update(slice, updater)                - generic; updater can be fn or value
//   store.batch(fn)                             - apply many updates, notify once
//   store.updateSessions(fn) / updateRecovery(fn) / ...  - per-slice setters
//   store.setActiveGoalId(id) / setActiveProgramId(id)   - scalar slices
//
// Loaded as a classic script tag (not an ES module) so the existing script-tag
// app keeps working. Listed in index.html before app.js so `store` is in scope
// during app.js init.

const store = (() => {
  const state = {};
  /** @type {Record<string, { storageKey: string, serialize?: "raw" }>} */
  const persistConfig = {};
  const listeners = new Set();
  let mirrorFn = () => {};
  let notifying = false;
  let batching = 0;
  let batchDirty = false;

  // Freeze each slice one level deep so accidental in-place writes (e.g.,
  // `state.recovery[0].score = 9`) fail loudly instead of silently bypassing
  // persistSlice / mirrorFn / notify. Object.freeze is idempotent so it is
  // safe to call repeatedly on the same internal reference.
  const getState = () => {
    const snapshot = {};
    for (const key of Object.keys(state)) {
      const value = state[key];
      snapshot[key] = value && typeof value === "object" ? Object.freeze(value) : value;
    }
    return Object.freeze(snapshot);
  };

  const persistSlice = (slice, value) => {
    const cfg = persistConfig[slice];
    if (!cfg) return;
    if (cfg.serialize === "raw") {
      if (value == null) localStorage.removeItem(cfg.storageKey);
      else localStorage.setItem(cfg.storageKey, String(value));
      return;
    }
    // Serialize defensively: JSON.stringify returns undefined for top-level
    // undefined/functions/symbols, and throws on circular refs. In either
    // case, clear the stored slot so localStorage cannot end up holding the
    // literal string "undefined" (which would re-parse as the string
    // "undefined" on the next page load).
    let serialized;
    try {
      serialized = JSON.stringify(value);
    } catch (error) {
      console.error(`[store] failed to serialize slice "${slice}":`, error);
      localStorage.removeItem(cfg.storageKey);
      return;
    }
    if (serialized === undefined) {
      localStorage.removeItem(cfg.storageKey);
      return;
    }
    localStorage.setItem(cfg.storageKey, serialized);
  };

  // Per-listener try/catch so one throwing subscriber does not block the
  // others (e.g., a render error must not skip persistence-status updates).
  const notify = () => {
    if (notifying) return;
    notifying = true;
    try {
      const snapshot = getState();
      for (const listener of listeners) {
        try {
          listener(snapshot);
        } catch (error) {
          console.error("[store] subscriber threw:", error);
        }
      }
    } finally {
      notifying = false;
    }
  };

  // Mutation is transactional: if localStorage rejects the write (quota
  // exceeded, private-mode restrictions, ...) we restore the prior slice so
  // in-memory state cannot drift from what is actually persisted.
  // mirrorFn errors are surfaced but do not block subscribers from seeing
  // the committed state - readers must not be left stale just because the
  // IDB mirror failed.
  const update = (slice, updater) => {
    const prev = state[slice];
    const next = typeof updater === "function" ? updater(prev) : updater;
    if (next === prev) return;
    state[slice] = next;
    try {
      persistSlice(slice, next);
    } catch (error) {
      state[slice] = prev;
      throw error;
    }
    let mirrorError = null;
    try {
      mirrorFn();
    } catch (error) {
      mirrorError = error;
    }
    if (batching > 0) {
      batchDirty = true;
    } else {
      notify();
    }
    if (mirrorError) throw mirrorError;
  };

  // Group multiple updates so subscribers only see one snapshot. Reentrant:
  // nested batches collapse into the outermost one. Errors thrown by `fn`
  // still notify if any update succeeded, so subscribers do not stay stale.
  const batch = (fn) => {
    batching += 1;
    try {
      fn();
    } finally {
      batching -= 1;
      if (batching === 0 && batchDirty) {
        batchDirty = false;
        notify();
      }
    }
  };

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const init = ({ values, persist }, mirror) => {
    Object.assign(state, values);
    Object.assign(persistConfig, persist);
    if (typeof mirror === "function") mirrorFn = mirror;
  };

  return {
    init,
    getState,
    subscribe,
    update,
    batch,
    updateSessions: (fn) => update("sessions", fn),
    updatePlannedSessions: (fn) => update("plannedSessions", fn),
    updateRecovery: (fn) => update("recovery", fn),
    updateAthleteProfile: (fn) => update("athleteProfile", fn),
    updateCustomDrills: (fn) => update("customDrills", fn),
    updateReadinessCheckins: (fn) => update("readinessCheckins", fn),
    updateGolfClubBag: (fn) => update("golfClubBag", fn),
    updateGpsRound: (fn) => update("gpsRound", fn),
    setActiveGoalId: (id) => update("activeGoalId", id),
    setActiveProgramId: (id) => update("activeProgramId", id),
  };
})();

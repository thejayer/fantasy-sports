// Hydrate the signed-in member's log before app.js boots.
//
// Flow:
//   1. GET /api/me  (401 → /login)
//   2. If the server profile is empty, copy legacy athleteLog.* once
//   3. Write the member's slices into athleteLog.<userKey>.*
//   4. Load app.js so store.init reads the namespaced keys
//   5. Debounce PUT /api/me on store changes
(function () {
  const ANON_KEYS = {
    sessions: "athleteLog.sessions.v1",
    plannedSessions: "athleteLog.planner.v1",
    recovery: "athleteLog.recovery.v1",
    customDrills: "athleteLog.customDrills.v1",
    readinessCheckins: "athleteLog.readiness.v1",
    athleteProfile: "athleteLog.profile.v1",
    activeGoalId: "athleteLog.goal.v1",
    activeProgramId: "athleteLog.program.v1",
    golfClubBag: "athleteLog.golfClubBag.v1",
    gpsRound: "athleteLog.golfGpsRound.v1",
  };

  function parseJson(raw, fallback) {
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function readAnonymousSlices() {
    const sessions = parseJson(localStorage.getItem(ANON_KEYS.sessions), null);
    const planned = parseJson(localStorage.getItem(ANON_KEYS.plannedSessions), null);
    const recovery = parseJson(localStorage.getItem(ANON_KEYS.recovery), null);
    const drills = parseJson(localStorage.getItem(ANON_KEYS.customDrills), null);
    const readiness = parseJson(localStorage.getItem(ANON_KEYS.readinessCheckins), null);
    if (
      !Array.isArray(sessions) &&
      !Array.isArray(planned) &&
      !Array.isArray(recovery) &&
      !Array.isArray(drills) &&
      !Array.isArray(readiness)
    ) {
      return null;
    }
    return {
      sessions: Array.isArray(sessions) ? sessions : [],
      plannedSessions: Array.isArray(planned) ? planned : [],
      recovery: Array.isArray(recovery) ? recovery : [],
      customDrills: Array.isArray(drills) ? drills : [],
      readinessCheckins: Array.isArray(readiness) ? readiness : [],
      athleteProfile: parseJson(localStorage.getItem(ANON_KEYS.athleteProfile), null),
      activeGoalId: localStorage.getItem(ANON_KEYS.activeGoalId),
      activeProgramId: localStorage.getItem(ANON_KEYS.activeProgramId),
      golfClubBag: parseJson(localStorage.getItem(ANON_KEYS.golfClubBag), null),
      gpsRound: parseJson(localStorage.getItem(ANON_KEYS.gpsRound), null),
    };
  }

  function anonymousHasTraining(slices) {
    if (!slices) return false;
    return (
      slices.sessions.length +
        slices.plannedSessions.length +
        slices.recovery.length +
        slices.customDrills.length +
        slices.readinessCheckins.length >
      0
    );
  }

  function writeNamespaced(prefix, slices) {
    const put = (suffix, value, raw) => {
      const key = `${prefix}.${suffix}`;
      if (value == null) {
        localStorage.removeItem(key);
        return;
      }
      localStorage.setItem(key, raw ? String(value) : JSON.stringify(value));
    };
    put("sessions.v1", slices.sessions);
    put("planner.v1", slices.plannedSessions);
    put("recovery.v1", slices.recovery);
    put("customDrills.v1", slices.customDrills);
    put("readiness.v1", slices.readinessCheckins);
    put("profile.v1", slices.athleteProfile);
    put("goal.v1", slices.activeGoalId, true);
    put("program.v1", slices.activeProgramId, true);
    put("golfClubBag.v1", slices.golfClubBag);
    put("golfGpsRound.v1", slices.gpsRound);
  }

  function readNamespacedSlices(prefix) {
    const read = (suffix, raw) => {
      const value = localStorage.getItem(`${prefix}.${suffix}`);
      if (raw) return value;
      return parseJson(value, null);
    };
    return {
      sessions: read("sessions.v1") || [],
      plannedSessions: read("planner.v1") || [],
      recovery: read("recovery.v1") || [],
      customDrills: read("customDrills.v1") || [],
      readinessCheckins: read("readiness.v1") || [],
      athleteProfile: read("profile.v1"),
      activeGoalId: read("goal.v1", true),
      activeProgramId: read("program.v1", true),
      golfClubBag: read("golfClubBag.v1"),
      gpsRound: read("golfGpsRound.v1"),
    };
  }

  function loadAppScript() {
    return new Promise((resolve, reject) => {
      if (document.querySelector("script[data-sj-fitness-app]")) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = "app.js";
      script.dataset.sjFitnessApp = "1";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("failed to load app.js"));
      document.body.appendChild(script);
    });
  }

  async function fetchMe() {
    const response = await fetch("/api/me", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (response.status === 401) {
      const next = `/login?callbackUrl=${encodeURIComponent(location.pathname + location.search)}`;
      location.replace(next);
      return null;
    }
    if (!response.ok) {
      throw new Error(`fitness profile failed (${response.status})`);
    }
    return response.json();
  }

  async function putMe(slices, migrate) {
    const response = await fetch("/api/me", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ slices, migrate: migrate === true }),
    });
    if (response.status === 401) {
      location.replace("/login");
      return null;
    }
    if (response.status === 409) {
      return fetchMe();
    }
    if (!response.ok) {
      throw new Error(`fitness save failed (${response.status})`);
    }
    return response.json();
  }

  function bindPush(prefix) {
    if (typeof store === "undefined" || typeof store.subscribe !== "function") return;
    let timer = 0;
    const flush = () => {
      const slices = readNamespacedSlices(prefix);
      putMe(slices, false).catch((error) => {
        console.error("[fitness] sync failed:", error);
      });
    };
    store.subscribe(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, 800);
    });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }

  async function boot() {
    const payload = await fetchMe();
    if (!payload) return;

    const prefix = payload.storagePrefix;
    const document = payload.document;
    let slices = document && document.slices ? document.slices : null;
    const serverHasTraining =
      slices &&
      (slices.sessions.length ||
        slices.plannedSessions.length ||
        slices.recovery.length ||
        slices.customDrills.length ||
        slices.readinessCheckins.length);

    if (!serverHasTraining && !document.migrated_from_anonymous) {
      const anonymous = readAnonymousSlices();
      if (anonymousHasTraining(anonymous)) {
        const migrated = await putMe(anonymous, true);
        slices = migrated && migrated.document ? migrated.document.slices : anonymous;
      }
    }

    if (slices) writeNamespaced(prefix, slices);

    window.__sjFitness = {
      user: payload.user,
      storagePrefix: prefix,
      document,
    };
    window.dispatchEvent(new CustomEvent("sj-fitness-ready"));

    await loadAppScript();
    bindPush(prefix);
  }

  boot().catch((error) => {
    console.error("[fitness] boot failed:", error);
  });
})();

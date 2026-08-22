// @ts-nocheck -- DOM- and IDB-heavy state container. State now lives in
// store.js (COM-150); the remaining type cleanup of app.js is tracked under
// COM-154 alongside render.js / events.js / service-worker.js.
const storageKey = "athleteLog.sessions.v1";
const recoveryStorageKey = "athleteLog.recovery.v1";
const plannerStorageKey = "athleteLog.planner.v1";
const goalStorageKey = "athleteLog.goal.v1";
const programStorageKey = "athleteLog.program.v1";
const profileStorageKey = "athleteLog.profile.v1";
const customDrillStorageKey = "athleteLog.customDrills.v1";
const readinessStorageKey = "athleteLog.readiness.v1";
const golfClubBagStorageKey = "athleteLog.golfClubBag.v1";
const golfGpsRoundStorageKey = "athleteLog.golfGpsRound.v1";
const dbName = "athleteLog.db";
const dbVersion = 1;
let athleteDb = null;

const createId = () => `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const createDrillId = () => `drill-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function getTemplate(type) {
  return sessionTemplates.find((template) => template.type === type) || sessionTemplates[0];
}

const getGoal = (goalId) => goals.find((goal) => goal.id === goalId) || goals[0];

const getDefaultGoalForSport = (sport) =>
  goals.find((goal) => goal.sport === sport || goal.relatedSports.includes(sport)) || goals[0];

const normalizeGoalId = (goalId, fallback = goals[0].id) =>
  goals.some((goal) => goal.id === goalId) ? goalId : fallback;

const getDefaultProgramIdForSport = (sport) => {
  if (sport === "Golf") return "golf-power";
  if (sport === "Tennis") return "tennis-durability";
  if (sport === "Pickleball") return "pickleball-resilience";
  return "hybrid-base";
};

const normalizeProgramId = (programId, fallback = programBlueprints[0].id) =>
  programBlueprints.some((program) => program.id === programId) ? programId : fallback;

const findActiveItemId = (items) => {
  if (!Array.isArray(items)) return null;
  return items.find((item) => item?.active || item?.isActive || item?.selected)?.id || null;
};

const cloneItems = (items) =>
  items.map((item) => ({
    ...item,
    values: { ...(item.values || {}) },
    sets: Array.isArray(item.sets) ? item.sets.map((set) => ({ ...set })) : item.sets,
  }));

const normalizeSession = (session, index = 0) => ({
  id: session.id || createId(),
  date: session.date || daysAgo(index),
  type: session.type || "Golf Range Session",
  durationMinutes: session.durationMinutes || Number.parseInt(session.duration, 10) || 45,
  effortScore: session.effortScore || Number.parseInt(session.effort, 10) || 5,
  outcome: session.outcome || getTemplate(session.type || "Golf Range Session").defaultOutcome,
  values: session.values || {},
  sets: Array.isArray(session.sets) ? session.sets : [],
  note: session.note || "",
});

const storedSessions = readStoredJson(storageKey, null);
const initialSessions = (
  Array.isArray(storedSessions) ? storedSessions : cloneItems(defaultSessions)
).map(normalizeSession);
let editingSessionId = null;
let editingCustomDrillId = null;
let activeSessionId = initialSessions[0]?.id || null;

const normalizePlan = (plan) => ({
  id: plan.id || createId(),
  day: plannerDays.includes(plan.day) ? plan.day : "Mon",
  type: plan.type || "Golf Range Session",
  durationMinutes:
    Number(plan.durationMinutes) || getTemplate(plan.type || "Golf Range Session").defaultDuration,
  priority: plan.priority || "Normal",
  customDrillId: plan.customDrillId || null,
});

const normalizeCustomDrill = (drill) => {
  const template = getTemplate(drill.type || "Golf Range Session");
  return {
    id: drill.id || createDrillId(),
    sport: template.sport,
    type: template.type,
    title: drill.title || `${template.title} custom`,
    tags: Array.isArray(drill.tags) ? drill.tags : [],
    detail: drill.detail || template.description,
    cue: drill.cue || "Keep the intent clear and stop when quality drops.",
    createdAt: drill.createdAt || getToday(),
  };
};

const storedPlannedSessions = readStoredJson(plannerStorageKey, null);
const initialPlannedSessions = (
  Array.isArray(storedPlannedSessions) ? storedPlannedSessions : cloneItems(defaultPlannedSessions)
).map(normalizePlan);

const storedRecovery = readStoredJson(recoveryStorageKey, null);
const storedCustomDrills = readStoredJson(customDrillStorageKey, null);
const storedReadinessCheckins = readStoredJson(readinessStorageKey, null);
const initialRecovery = Array.isArray(storedRecovery)
  ? storedRecovery
  : cloneItems(defaultRecovery);
const initialCustomDrills = (Array.isArray(storedCustomDrills) ? storedCustomDrills : []).map(
  normalizeCustomDrill
);
const initialReadinessCheckins = Array.isArray(storedReadinessCheckins)
  ? storedReadinessCheckins
  : [];
const storedProfile = readStoredJson(profileStorageKey, null);
const getKnownSports = () => sportProfiles.map((profile) => profile.sport);

const cleanCommaList = (value, fallback = "") =>
  String(value || fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(", ");

const normalizeProfileSports = (sports, primarySport) => {
  const knownSports = getKnownSports();
  const hasExplicitSports = Array.isArray(sports) || Boolean(String(sports || "").trim());
  const source = Array.isArray(sports)
    ? sports
    : String(sports || "")
        .split(",")
        .map((sport) => sport.trim());
  const cleanSports = source.filter(
    (sport, index, list) => knownSports.includes(sport) && list.indexOf(sport) === index
  );
  const selected = cleanSports.length
    ? cleanSports
    : hasExplicitSports
      ? []
      : [...defaultProfile.activeSports];
  if (!selected.includes(primarySport)) selected.unshift(primarySport);
  return selected.filter(
    (sport, index, list) => knownSports.includes(sport) && list.indexOf(sport) === index
  );
};

const normalizeSportPriorities = (
  priorities = {},
  activeSports = [],
  primarySport = defaultProfile.primarySport
) => {
  const source =
    priorities && typeof priorities === "object" && !Array.isArray(priorities) ? priorities : {};
  const normalizedPrimary = getKnownSports().includes(primarySport)
    ? primarySport
    : defaultProfile.primarySport;
  return getKnownSports().reduce((clean, sport) => {
    const fallback =
      sport === normalizedPrimary
        ? "Primary"
        : activeSports.includes(sport)
          ? "Secondary"
          : "Support";
    clean[sport] = profileSportRoles.includes(source[sport]) ? source[sport] : fallback;
    return clean;
  }, {});
};

const normalizeProfileOption = (value, options, fallback) =>
  options.includes(value) ? value : fallback;

const normalizeAthleteProfile = (profile = {}) => {
  const source = profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
  const knownSports = getKnownSports();
  const primarySport = knownSports.includes(source.primarySport)
    ? source.primarySport
    : defaultProfile.primarySport;
  const activeSports = normalizeProfileSports(
    source.activeSports || source.playedSports,
    primarySport
  );
  const sportPriorities = normalizeSportPriorities(
    source.sportPriorities,
    activeSports,
    primarySport
  );
  const goalId = normalizeGoalId(
    source.goalId || source.activeGoalId || findActiveItemId(source.goals),
    getDefaultGoalForSport(primarySport).id
  );
  const programId = normalizeProgramId(
    source.programId || source.activeProgramId || findActiveItemId(source.programs),
    getDefaultProgramIdForSport(primarySport)
  );

  return {
    ...defaultProfile,
    ...source,
    name: String(source.name || defaultProfile.name).trim() || defaultProfile.name,
    primarySport,
    activeSports,
    sportPriorities,
    goalId,
    activeGoalId: normalizeGoalId(
      source.activeGoalId || findActiveItemId(source.goals) || goalId,
      goalId
    ),
    programId,
    activeProgramId: normalizeProgramId(
      source.activeProgramId || findActiveItemId(source.programs) || programId,
      programId
    ),
    weeklyDays: Math.max(1, Math.min(7, Number(source.weeklyDays) || defaultProfile.weeklyDays)),
    trainingDays: cleanCommaList(source.trainingDays, defaultProfile.trainingDays),
    trainingStyle: normalizeProfileOption(
      source.trainingStyle,
      profileTrainingStyles,
      defaultProfile.trainingStyle
    ),
    preferredSessionLength: normalizeProfileOption(
      source.preferredSessionLength,
      profileSessionLengths,
      defaultProfile.preferredSessionLength
    ),
    intensityPreference: normalizeProfileOption(
      source.intensityPreference,
      profileIntensityOptions,
      defaultProfile.intensityPreference
    ),
    experienceLevel: normalizeProfileOption(
      source.experienceLevel,
      profileExperienceLevels,
      defaultProfile.experienceLevel
    ),
    access: cleanCommaList(source.access, defaultProfile.access),
    otherActivities: cleanCommaList(source.otherActivities, defaultProfile.otherActivities),
    watchAreas: cleanCommaList(source.watchAreas, defaultProfile.watchAreas),
    note: String(source.note || defaultProfile.note).trim(),
  };
};

const initialAthleteProfile = normalizeAthleteProfile(storedProfile);
const storedGoalId = localStorage.getItem(goalStorageKey);
const initialActiveGoalId = storedGoalId || initialAthleteProfile.goalId || goals[0].id;
const storedProgramId = localStorage.getItem(programStorageKey);
const initialActiveProgramId = normalizeProgramId(storedProgramId, initialAthleteProfile.programId);
let snackbarTimer;
// eslint-disable-next-line prefer-const -- reassigned in events.js (calendar nav).
let calendarCursor = new Date();
calendarCursor.setDate(1);
// eslint-disable-next-line prefer-const -- reassigned in events.js (PWA install prompt).
let installPromptEvent = null;

const defaultGpsRoundScore = () =>
  golfGpsCourse.holes.reduce((score, hole) => {
    score[hole.number] = {
      strokes: "",
      putts: "",
      fairway: "Hit",
      gir: "Yes",
      penalty: "0",
      club: "",
      shotResult: "Center",
      lie: "Tee",
      shotType: "Stock",
      strategyNote: "",
      shots: [],
    };
    return score;
  }, {});
const normalizeGolfClubBag = (clubs) => {
  const source = Array.isArray(clubs) && clubs.length ? clubs : golfClubDistances;
  const normalized = source
    .map((club) => ({
      club: String(club.club || "").trim(),
      carry: Number(club.carry),
      total: Number(club.total),
    }))
    .filter((club) => club.club && Number.isFinite(club.carry) && club.carry >= 0)
    .map((club) => ({
      club: club.club,
      carry: club.carry,
      total:
        Number.isFinite(club.total) && club.total >= 0 ? club.total : Math.round(club.carry * 1.07),
    }));
  const hasPlayableClub = normalized.some((club) => club.club !== "Putter" && club.carry > 0);
  if (hasPlayableClub) return normalized;

  return golfClubDistances.map((club) => ({
    club: club.club,
    carry: Number(club.carry) || 0,
    total: Number(club.total) || Math.round((Number(club.carry) || 0) * 1.07),
  }));
};
const storedClubBag = readStoredJson(golfClubBagStorageKey, null);
const initialGolfClubBag = normalizeGolfClubBag(storedClubBag);
const storedGpsRound = readStoredJson(golfGpsRoundStorageKey, null);
const initialGpsRound = {
  activeGpsHole: golfGpsCourse.holes.some(
    (hole) => hole.number === Number(storedGpsRound?.activeGpsHole)
  )
    ? Number(storedGpsRound.activeGpsHole)
    : 1,
  windAdjustment: Number(storedGpsRound?.windAdjustment) || 0,
  elevationAdjustment: Number(storedGpsRound?.elevationAdjustment) || 0,
  temperature: Number(storedGpsRound?.temperature) || 72,
  startedAt: storedGpsRound?.startedAt || null,
  savedSessionId: storedGpsRound?.savedSessionId || null,
  score: {
    ...defaultGpsRoundScore(),
    ...(storedGpsRound?.score && typeof storedGpsRound.score === "object"
      ? storedGpsRound.score
      : {}),
  },
};

// Seed the store now that every initial slice has been computed. mirrorStateToDb
// is wired below; we re-bind it after definition so it can read store snapshots
// directly without going through the local-var aliases.
store.init(
  {
    values: {
      sessions: initialSessions,
      plannedSessions: initialPlannedSessions,
      recovery: initialRecovery,
      customDrills: initialCustomDrills,
      readinessCheckins: initialReadinessCheckins,
      athleteProfile: initialAthleteProfile,
      activeGoalId: initialActiveGoalId,
      activeProgramId: initialActiveProgramId,
      golfClubBag: initialGolfClubBag,
      gpsRound: initialGpsRound,
    },
    persist: {
      sessions: { storageKey },
      plannedSessions: { storageKey: plannerStorageKey },
      recovery: { storageKey: recoveryStorageKey },
      customDrills: { storageKey: customDrillStorageKey },
      readinessCheckins: { storageKey: readinessStorageKey },
      athleteProfile: { storageKey: profileStorageKey },
      activeGoalId: { storageKey: goalStorageKey, serialize: "raw" },
      activeProgramId: { storageKey: programStorageKey, serialize: "raw" },
      golfClubBag: { storageKey: golfClubBagStorageKey },
      gpsRound: { storageKey: golfGpsRoundStorageKey },
    },
  },
  () => mirrorStateToDb()
);

// Local aliases kept in sync with the store. The script-tag files have ~350
// read sites for these names; the subscriber below refreshes them after every
// mutation so existing reads keep working unchanged.
let sessions;
let plannedSessions;
let recovery;
let customDrills;
let readinessCheckins;
let athleteProfile;
let activeGoalId;
let activeProgramId;
let golfClubBag;
let activeGpsHole;
let gpsWindAdjustment;
let gpsElevationAdjustment;
let gpsTemperature;
let gpsRoundStartedAt;
let gpsSavedSessionId;
let gpsRoundScore;

const syncLocalStateFromStore = () => {
  const s = store.getState();
  sessions = s.sessions;
  plannedSessions = s.plannedSessions;
  recovery = s.recovery;
  customDrills = s.customDrills;
  readinessCheckins = s.readinessCheckins;
  athleteProfile = s.athleteProfile;
  activeGoalId = s.activeGoalId;
  activeProgramId = s.activeProgramId;
  golfClubBag = s.golfClubBag;
  const g = s.gpsRound || {};
  activeGpsHole = g.activeGpsHole;
  gpsWindAdjustment = g.windAdjustment;
  gpsElevationAdjustment = g.elevationAdjustment;
  gpsTemperature = g.temperature;
  gpsRoundStartedAt = g.startedAt;
  gpsSavedSessionId = g.savedSessionId;
  gpsRoundScore = g.score;
};
syncLocalStateFromStore();
store.subscribe(syncLocalStateFromStore);

const openAthleteDb = () =>
  new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }

    const request = indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
    };
    request.onsuccess = () => {
      athleteDb = request.result;
      resolve(athleteDb);
    };
    request.onerror = () => reject(request.error);
  });

const writeDbState = (key, value) => {
  if (!athleteDb) return;
  const transaction = athleteDb.transaction("state", "readwrite");
  transaction.objectStore("state").put(value, key);
};

const mirrorStateToDb = () => {
  try {
    const s = store.getState();
    writeDbState("sessions", s.sessions);
    writeDbState("plannedSessions", s.plannedSessions);
    writeDbState("recovery", s.recovery);
    writeDbState("activeGoalId", s.activeGoalId);
    writeDbState("activeProgramId", s.activeProgramId);
    writeDbState("athleteProfile", s.athleteProfile);
    writeDbState("customDrills", s.customDrills);
    writeDbState("readinessCheckins", s.readinessCheckins);
    writeDbState("golfClubBag", s.golfClubBag);
    writeDbState("golfGpsRound", s.gpsRound);
    writeDbState("lastSyncedAt", new Date().toISOString());
  } catch (_error) {
    renderPersistenceStatus(
      "Local fallback active",
      "IndexedDB backup could not update, so localStorage is carrying the save."
    );
  }
};

const getProfileSports = () =>
  normalizeProfileSports(athleteProfile.activeSports, athleteProfile.primarySport);

const isProfileSportActive = (sport) => getProfileSports().includes(sport);

const getProfileSportRole = (sport) =>
  athleteProfile.sportPriorities?.[sport] ||
  (sport === athleteProfile.primarySport ? "Primary" : "Secondary");

const getProfileRoleRank = (sport) =>
  ({ Primary: 0, Secondary: 1, Support: 2 })[getProfileSportRole(sport)] ?? 3;

const getActiveSportProfiles = () => {
  const profiles = sportProfiles
    .filter((profile) => isProfileSportActive(profile.sport))
    .sort((a, b) => {
      if (a.sport === athleteProfile.primarySport) return -1;
      if (b.sport === athleteProfile.primarySport) return 1;
      return (
        getProfileRoleRank(a.sport) - getProfileRoleRank(b.sport) || a.sport.localeCompare(b.sport)
      );
    });

  return profiles.length ? profiles : [getSportProfile(athleteProfile.primarySport)];
};

const getProfileRecommendedTypes = () => {
  const types = getActiveSportProfiles().flatMap((profile) => profile.nextTypes);
  return [...new Set(types)].filter((type) => isProfileSportActive(getTemplate(type).sport));
};

const getProfileProgramId = () =>
  normalizeProgramId(
    athleteProfile.programId,
    getDefaultProgramIdForSport(athleteProfile.primarySport)
  );

const getProfileActiveGoalId = (profile, fallback) =>
  normalizeGoalId(
    profile.activeGoalId || findActiveItemId(profile.goals) || profile.goalId,
    fallback
  );

const getProfileActiveProgramId = (profile, fallback) =>
  normalizeProgramId(
    profile.activeProgramId || findActiveItemId(profile.programs) || profile.programId,
    fallback
  );

const getProfileSummary = () => {
  const activeSports = getActiveSportProfiles();
  const sportNames = activeSports.map((profile) => profile.sport);
  const supportSports = activeSports
    .filter((profile) => getProfileSportRole(profile.sport) === "Support")
    .map((profile) => profile.sport);
  const focusGoal = getGoal(athleteProfile.goalId);
  const profileComplete = [
    athleteProfile.name,
    athleteProfile.primarySport,
    athleteProfile.goalId,
    athleteProfile.trainingDays,
    athleteProfile.watchAreas,
    athleteProfile.access,
    athleteProfile.note,
  ].filter(Boolean).length;

  return {
    activeSports,
    sportNames,
    supportSports,
    focusGoal,
    completion: Math.round((profileComplete / 7) * 100),
    cadence: `${athleteProfile.weeklyDays} days/week, ${athleteProfile.preferredSessionLength}`,
    bias: `${athleteProfile.trainingStyle} with ${athleteProfile.intensityPreference.toLowerCase()} intensity`,
  };
};

const showToast = (message) => {
  const snackbar = document.querySelector("#snackbar");
  snackbar.textContent = message;
  snackbar.classList.add("show");
  clearTimeout(snackbarTimer);
  snackbarTimer = setTimeout(() => {
    snackbar.classList.remove("show");
  }, 2600);
};

const getActiveGpsHole = () =>
  golfGpsCourse.holes.find((hole) => hole.number === activeGpsHole) || golfGpsCourse.holes[0];

const getGpsHoleScore = (holeNumber = activeGpsHole) => gpsRoundScore[holeNumber] || {};

const getAdjustedYardage = (hole = getActiveGpsHole()) => {
  const windMap = {
    Into: 8,
    Helping: -6,
    Cross: 3,
    Calm: 0,
  };
  const score = getGpsHoleScore(hole.number);
  const lieMap = {
    Tee: 0,
    Fairway: 0,
    Rough: 7,
    Sand: 12,
    Recovery: 18,
    Green: -hole.green,
  };
  const shotTypeMap = {
    Stock: 0,
    Knockdown: 8,
    Flighted: 5,
    "Speed swing": -8,
    Punch: 15,
  };
  const temperatureAdjustment = Math.round((72 - gpsTemperature) * 0.35);
  return Math.max(
    1,
    Math.round(
      hole.green +
        (windMap[hole.wind] || 0) +
        gpsWindAdjustment +
        gpsElevationAdjustment +
        temperatureAdjustment +
        (lieMap[score.lie] || 0) +
        (shotTypeMap[score.shotType] || 0)
    )
  );
};

const getRecommendedClub = (yardage = getAdjustedYardage()) => {
  const playableClubs = normalizeGolfClubBag(golfClubBag).filter(
    (club) => club.club !== "Putter" && club.carry > 0
  );
  return playableClubs.reduce(
    (best, club) => (Math.abs(club.carry - yardage) < Math.abs(best.carry - yardage) ? club : best),
    playableClubs[0]
  );
};

const updateGpsHoleScore = (markDirty = false) => {
  const hole = getActiveGpsHole();
  const nextEntry = {
    strokes: document.querySelector("#gpsStrokes")?.value || "",
    putts: document.querySelector("#gpsPutts")?.value || "",
    fairway: document.querySelector("#gpsFairway")?.value || "Hit",
    gir: document.querySelector("#gpsGir")?.value || "Yes",
    penalty: document.querySelector("#gpsPenalty")?.value || "0",
    club: document.querySelector("#gpsClub")?.value || "",
    shotResult: document.querySelector("#gpsShotResult")?.value || "Center",
    lie: document.querySelector("#gpsLie")?.value || "Tee",
    shotType: document.querySelector("#gpsShotType")?.value || "Stock",
    strategyNote: document.querySelector("#gpsStrategyNote")?.value || "",
    shots: getGpsHoleScore(hole.number).shots || [],
  };
  store.updateGpsRound((g) => ({
    ...g,
    score: { ...g.score, [hole.number]: nextEntry },
    ...(markDirty ? { savedSessionId: null } : {}),
  }));
};

const getGpsRoundTotals = () => {
  const scoredHoles = golfGpsCourse.holes
    .map((hole) => ({ hole, score: getGpsHoleScore(hole.number) }))
    .filter((item) => Number(item.score.strokes));
  const strokes = scoredHoles.reduce((sum, item) => sum + Number(item.score.strokes || 0), 0);
  const par = scoredHoles.reduce((sum, item) => sum + item.hole.par, 0);
  const putts = scoredHoles.reduce((sum, item) => sum + Number(item.score.putts || 0), 0);
  const fairways = scoredHoles.filter(
    (item) => item.hole.par > 3 && item.score.fairway === "Hit"
  ).length;
  const fairwayHoles = scoredHoles.filter((item) => item.hole.par > 3).length;
  const greens = scoredHoles.filter((item) => item.score.gir === "Yes").length;
  const penalties = scoredHoles.reduce((sum, item) => sum + Number(item.score.penalty || 0), 0);
  const bigMisses = scoredHoles.filter((item) =>
    ["Left", "Right", "Short", "Long", "Penalty"].includes(item.score.shotResult)
  ).length;
  const shots = scoredHoles.flatMap((item) => item.score.shots || []);
  const recoveryShots = shots.filter(
    (shot) => ["Recovery", "Sand", "Rough"].includes(shot.lie) || shot.result === "Penalty"
  ).length;

  return {
    holes: scoredHoles.length,
    strokes,
    par,
    toPar: strokes - par,
    putts,
    fairways,
    fairwayHoles,
    greens,
    penalties,
    bigMisses,
    shots,
    recoveryShots,
  };
};

const getGpsRoundInsights = () => {
  const totals = getGpsRoundTotals();
  const fairwayRate = totals.fairwayHoles
    ? Math.round((totals.fairways / totals.fairwayHoles) * 100)
    : 0;
  const girRate = totals.holes ? Math.round((totals.greens / totals.holes) * 100) : 0;
  const puttingLoad = totals.holes ? totals.putts / totals.holes : 0;
  const teeLost =
    Math.max(0, totals.fairwayHoles - totals.fairways) * 0.35 + totals.penalties * 0.75;
  const approachLost = Math.max(0, totals.holes - totals.greens) * 0.28;
  const shortGameLost = Math.max(0, totals.recoveryShots) * 0.18;
  const puttingLost = Math.max(0, totals.putts - totals.holes * 1.85) * 0.45;
  const buckets = [
    { label: "Tee", value: teeLost },
    { label: "Approach", value: approachLost },
    { label: "Short game", value: shortGameLost },
    { label: "Putting", value: puttingLost },
  ].sort((a, b) => b.value - a.value);
  const biggestLeak = buckets[0];
  const recap = totals.holes
    ? `${fairwayRate}% fairways, ${girRate}% GIR, ${totals.putts} putts, ${totals.penalties} penalties. Biggest leak: ${biggestLeak.label}.`
    : "Start scoring holes to unlock round recap insights.";
  const practicePlan =
    biggestLeak.label === "Tee"
      ? "Practice: 25 min driver start line, 20 min fairway finder swings, 15 min penalty-avoidance tee decisions."
      : biggestLeak.label === "Approach"
        ? "Practice: 30 min mid-iron target windows, 20 min wedge proximity, 10 min random club selection."
        : biggestLeak.label === "Putting"
          ? "Practice: 20 min lag speed gates, 20 min six-foot makes, 10 min pressure putting."
          : "Practice: 25 min up-and-down ladder, 20 min bunker/chip proximity, 15 min pressure wedges.";

  return {
    fairwayRate,
    girRate,
    puttingLoad,
    buckets,
    recap,
    practicePlan,
  };
};

const addGpsShot = () => {
  updateGpsHoleScore(true);
  const hole = getActiveGpsHole();
  const score = getGpsHoleScore(hole.number);
  const shot = {
    id: `shot-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    club: score.club || getRecommendedClub().club,
    lie: score.lie || "Tee",
    result: score.shotResult || "Center",
    shotType: score.shotType || "Stock",
    distance: getAdjustedYardage(hole),
  };
  store.updateGpsRound((g) => ({
    ...g,
    score: { ...g.score, [hole.number]: { ...score, shots: [...(score.shots || []), shot] } },
    savedSessionId: null,
  }));
};

const removeGpsShot = (shotId) => {
  const hole = getActiveGpsHole();
  const score = getGpsHoleScore(hole.number);
  store.updateGpsRound((g) => ({
    ...g,
    score: {
      ...g.score,
      [hole.number]: {
        ...score,
        shots: (score.shots || []).filter((shot) => shot.id !== shotId),
      },
    },
    savedSessionId: null,
  }));
};

const updateClubBagFromForm = () => {
  const nextBag = normalizeGolfClubBag(
    [...document.querySelectorAll("[data-club-row]")].map((row) => ({
      club: row.querySelector("[data-club-name]").textContent.trim(),
      carry: Number(row.querySelector("[data-club-carry]").value) || 0,
      total: Number(row.querySelector("[data-club-total]").value) || 0,
    }))
  );
  store.updateGolfClubBag(() => nextBag);
};

const resetGpsRound = () => {
  store.updateGpsRound(() => ({
    activeGpsHole: 1,
    windAdjustment: 0,
    elevationAdjustment: 0,
    temperature: 72,
    startedAt: new Date().toISOString(),
    savedSessionId: null,
    score: defaultGpsRoundScore(),
  }));
  showToast("GPS round reset");
};

const saveGpsRoundToLog = () => {
  updateGpsHoleScore();
  if (gpsSavedSessionId && sessions.some((session) => session.id === gpsSavedSessionId)) {
    activeSessionId = gpsSavedSessionId;
    showToast("This GPS round is already saved");
    setView("log", { focus: true });
    return;
  }
  const totals = getGpsRoundTotals();
  if (!totals.holes) {
    showToast("Score at least one hole before saving the round");
    return;
  }

  const roundSession = {
    id: createId(),
    date: getToday(),
    type: "Golf Round",
    durationMinutes: Math.max(90, totals.holes >= 18 ? 240 : 120),
    effortScore: 5,
    outcome: "Course management",
    values: {
      holes: totals.holes >= 18 ? "18" : "9",
      score: String(totals.strokes),
      fairways: String(totals.fairways),
      greens: String(totals.greens),
      putts: String(totals.putts),
      penalties: String(totals.penalties),
      threePutts: String(
        golfGpsCourse.holes.filter((hole) => Number(getGpsHoleScore(hole.number).putts || 0) >= 3)
          .length
      ),
      upDowns: "",
      sandSaves: "",
      lostShots: String(totals.bigMisses),
      walkRide: "Walked",
      gpsHoles: JSON.stringify(gpsRoundScore),
      strokesGainedLite: JSON.stringify(getGpsRoundInsights().buckets),
    },
    note: `GPS round at ${golfGpsCourse.name}. ${totals.holes} holes, ${totals.strokes} strokes (${totals.toPar >= 0 ? "+" : ""}${totals.toPar}), ${totals.fairways}/${totals.fairwayHoles} fairways, ${totals.greens} GIR, ${totals.putts} putts. ${getGpsRoundInsights().recap} ${getGpsRoundInsights().practicePlan}`,
  };

  activeSessionId = roundSession.id;
  store.updateSessions((list) => [roundSession, ...list]);
  store.updateGpsRound((g) => ({ ...g, savedSessionId: roundSession.id }));
  showToast("GPS round saved to golf log");
  setView("log", { focus: true });
};

const getSessionMinutes = (session) =>
  session.durationMinutes || Number.parseInt(session.duration, 10) || 0;

const getSessionEffort = (session) =>
  session.effortScore || Number.parseInt(session.effort, 10) || 0;

const getAllDrills = () => [
  ...drillLibrary.map((drill) => ({ ...drill, custom: false })),
  ...customDrills.map((drill) => ({ ...drill, custom: true })),
];

const getCustomDrill = (drillId) => customDrills.find((drill) => drill.id === drillId) || null;

const getPlanTemplate = (plan) => getTemplate(plan.type);

const getPlanTitle = (plan) =>
  getCustomDrill(plan.customDrillId)?.title || getPlanTemplate(plan).title;

const getPlanSport = (plan) => getPlanTemplate(plan).sport;

const parsePlanTypeValue = (value) => {
  if (!value.startsWith("custom:")) {
    return { type: value, customDrillId: null };
  }
  const drill = getCustomDrill(value.replace("custom:", ""));
  return {
    type: drill?.type || sessionTemplates[0].type,
    customDrillId: drill?.id || null,
  };
};

const getSelectedPlanTemplate = () => {
  const selection = parsePlanTypeValue(
    document.querySelector("#planType")?.value || sessionTemplates[0].type
  );
  return getTemplate(selection.type);
};

const formatDate = (value) => {
  const date = new Date(`${value}T12:00:00`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const getMonthLabel = (date) =>
  date.toLocaleDateString(undefined, { month: "long", year: "numeric" });

const getSessionSummary = (session) => {
  const template = getTemplate(session.type);
  const fieldSummary = template.fields
    .map((field) => {
      const value = session.values?.[field.id];
      return value ? `${field.label}: ${value}${field.unit ? ` ${field.unit}` : ""}` : "";
    })
    .filter(Boolean)
    .join(". ");

  return `${fieldSummary ? `${fieldSummary}. ` : ""}${session.note}`.trim();
};

const getFilteredSessions = () => {
  const filter = document.querySelector("#historyFilter")?.value || "All sports";
  const search = (document.querySelector("#historySearch")?.value || "").trim().toLowerCase();
  const sort = document.querySelector("#historySort")?.value || "newest";

  return sessions
    .filter((session) => filter === "All sports" || getTemplate(session.type).sport === filter)
    .filter((session) => {
      const haystack = [
        session.type,
        getTemplate(session.type).sport,
        session.outcome,
        session.note,
        ...Object.values(session.values || {}),
      ]
        .join(" ")
        .toLowerCase();

      return !search || haystack.includes(search);
    })
    .sort((a, b) => {
      if (sort === "oldest") return a.date.localeCompare(b.date);
      if (sort === "hardest") return getSessionEffort(b) - getSessionEffort(a);
      if (sort === "longest") return getSessionMinutes(b) - getSessionMinutes(a);
      return b.date.localeCompare(a.date);
    });
};

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const getProgramBlueprint = (id = activeProgramId) =>
  programBlueprints.find((program) => program.id === id) || programBlueprints[0];

const getProgramWeek = (program = getProgramBlueprint(), weekIndex = 0) =>
  program.weeks[weekIndex] || program.weeks[0];

const getProgramDuration = (type, volume) => {
  const base = getTemplate(type).defaultDuration;
  if (volume === "Low impact") return Math.max(25, Math.round(base * 0.75));
  if (volume === "High performance") return Math.min(240, Math.round(base * 1.18));
  return base;
};

const getProgramPriority = (type, index) =>
  index === 0 || type.includes("Round") || type.includes("Match") ? "Key session" : "Normal";

const createProgramPlan = (weekIndex = 0) => {
  const volume = document.querySelector("#programVolume")?.value || "Balanced";
  return getProgramWeek(getProgramBlueprint(), weekIndex).map((type, index) => ({
    id: createId(),
    day: plannerDays[index % plannerDays.length],
    type,
    durationMinutes: getProgramDuration(type, volume),
    priority: getProgramPriority(type, index),
  }));
};

const getCompletedProgramSessions = () => {
  const programTypes = new Set(getProgramBlueprint().weeks.flat());
  return sessions.filter((session) => programTypes.has(session.type)).length;
};

const createSmartProgramPlan = () => {
  const stats = getTrainingStats();
  const weekIndex = Math.min(
    3,
    Math.floor(getCompletedProgramSessions() / Math.max(1, Number(athleteProfile.weeklyDays) || 4))
  );
  const profilePlan = createProgramPlan(weekIndex).filter((item) =>
    isProfileSportActive(getTemplate(item.type).sport)
  );
  const plan = profilePlan.length ? profilePlan : createProgramPlan(weekIndex);
  const preferredDays = athleteProfile.trainingDays
    .split(",")
    .map((day) => day.trim().slice(0, 3))
    .filter((day) => plannerDays.includes(day));
  const targetDays = preferredDays.length ? preferredDays : plannerDays;
  const adjusted = plan.slice(
    0,
    Math.max(1, Math.min(targetDays.length, Number(athleteProfile.weeklyDays) || plan.length))
  );
  return adjusted.map((item, index) => ({
    ...item,
    day: targetDays[index % targetDays.length],
    durationMinutes:
      stats.readiness < 70
        ? Math.max(25, Math.round(item.durationMinutes * 0.8))
        : item.durationMinutes,
    priority:
      stats.highestFlag.score >= 7 && item.priority === "Key session" ? "Recovery" : item.priority,
  }));
};

const getSessionOptionLabel = (session) =>
  `${formatDate(session.date)} - ${session.type} - ${getSessionMinutes(session)} min`;

const serializeLogData = () => ({
  version: 1,
  exportedAt: new Date().toISOString(),
  sessions,
  plannedSessions,
  recovery,
  activeGoalId,
  activeProgramId,
  athleteProfile,
  customDrills,
  readinessCheckins,
  golfClubBag,
  golfGpsRound: store.getState().gpsRound,
});

const downloadTextFile = (filename, content, mimeType) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const parseCsvPreview = (input) => {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCsvRow(lines[0]).map((header) => header.trim().toLowerCase());
  return lines.slice(1, 5).map((line) => {
    const cells = parseCsvRow(line);
    const read = (...names) => {
      const index = headers.findIndex((header) => names.some((name) => header.includes(name)));
      return index >= 0 ? cells[index] : "";
    };
    return {
      date: read("date", "start"),
      type: read("type", "sport", "activity", "workout"),
      duration: read("duration", "elapsed", "time"),
      distance: read("distance", "miles", "km"),
      notes: read("notes", "name", "title"),
    };
  });
};

const getCalendarItems = () => {
  const completedItems = sessions.map((session) => ({
    id: session.id,
    date: session.date,
    title: getTemplate(session.type).title,
    sport: getTemplate(session.type).sport,
    status: "completed",
    meta: `${getSessionMinutes(session)} min`,
  }));

  const plannedItems = plannedSessions.map((plan) => ({
    id: plan.id,
    date: getPlanDate(plan.day),
    title: getPlanTitle(plan),
    sport: getPlanSport(plan),
    status: "planned",
    meta: plan.priority,
  }));

  return [...completedItems, ...plannedItems];
};

const resetCustomDrillForm = () => {
  editingCustomDrillId = null;
  document.querySelector("#customDrillTitle").value = "";
  document.querySelector("#customDrillTags").value = "";
  document.querySelector("#customDrillDetail").value = "";
  document.querySelector("#customDrillCue").value = "";
  document.querySelector("#customDrillForm button[type='submit']").textContent =
    "Save custom drill";
};

const loadCustomDrillForEdit = (drillId) => {
  const drill = getCustomDrill(drillId);
  if (!drill) return;

  editingCustomDrillId = drill.id;
  document.querySelector("#customDrillSport").value = drill.sport;
  renderCustomDrillTypeOptions();
  document.querySelector("#customDrillType").value = drill.type;
  document.querySelector("#customDrillTitle").value = drill.title;
  document.querySelector("#customDrillTags").value = drill.tags.join(", ");
  document.querySelector("#customDrillDetail").value = drill.detail;
  document.querySelector("#customDrillCue").value = drill.cue;
  document.querySelector("#customDrillForm button[type='submit']").textContent = "Save changes";
  document.querySelector("#customDrillForm").scrollIntoView({ behavior: "smooth", block: "start" });
};

const duplicateCustomDrill = (drillId) => {
  const drill = getCustomDrill(drillId);
  if (!drill) return;

  const copy = {
    ...drill,
    id: createDrillId(),
    title: `${drill.title} copy`,
    createdAt: getToday(),
  };
  store.updateCustomDrills((list) => [copy, ...list]);
  showToast("Custom template duplicated");
};

const getPlanDate = (day) => {
  const today = new Date();
  const monday = new Date(today);
  const dayOffset = (today.getDay() + 6) % 7;
  monday.setDate(today.getDate() - dayOffset);
  monday.setDate(monday.getDate() + plannerDays.indexOf(day));
  return getDateKey(monday);
};

const completePlannedSession = (planId) => {
  const plan = plannedSessions.find((item) => item.id === planId);
  if (!plan) return;

  const template = getPlanTemplate(plan);
  const customDrill = getCustomDrill(plan.customDrillId);
  const completedSession = {
    id: createId(),
    date: getPlanDate(plan.day),
    type: plan.type,
    durationMinutes: plan.durationMinutes,
    effortScore: template.defaultEffort,
    outcome: template.defaultOutcome,
    values: template.fields.reduce((values, field) => {
      values[field.id] = field.value || field.options?.[0] || "";
      return values;
    }, {}),
    note: customDrill
      ? `Completed from weekly planner custom template: ${customDrill.title}. ${customDrill.detail} Cue: ${customDrill.cue}`
      : `Completed from weekly planner. ${template.notes}`,
  };
  activeSessionId = completedSession.id;
  store.updateSessions((list) => [completedSession, ...list]);
  store.updatePlannedSessions((list) => list.filter((item) => item.id !== planId));
  showToast("Planned session completed and added to log");
};

const deletePlannedSession = (planId) => {
  store.updatePlannedSessions((list) => list.filter((item) => item.id !== planId));
  showToast("Planned session removed");
};

const getPlannerWarnings = () => {
  const warnings = [];
  const sportsByDay = plannerDays.map((day) => {
    const plans = plannedSessions.filter((plan) => plan.day === day);
    return plans.map(getPlanSport);
  });
  const hasEndurance = plannedSessions.some((plan) => getPlanSport(plan) === "Endurance");
  const hasStrength = plannedSessions.some((plan) => getPlanSport(plan) === "Strength");
  const courtSports = ["Tennis", "Pickleball"];

  if (!hasEndurance)
    warnings.push(
      "No endurance session planned. Add an easy run, ride, or swim for base and recovery."
    );
  if (!hasStrength)
    warnings.push("No strength session planned. Add one lift to support power and durability.");

  for (let index = 0; index < sportsByDay.length - 2; index += 1) {
    const threeDayCourtStack = [
      sportsByDay[index],
      sportsByDay[index + 1],
      sportsByDay[index + 2],
    ].every((sports) => sports.some((sport) => courtSports.includes(sport)));
    if (threeDayCourtStack) {
      warnings.push(
        "Three court-heavy days are stacked together. Consider a recovery or strength day between them."
      );
      break;
    }
  }

  if (
    plannedSessions.some((plan) => plan.type.includes("Tennis")) &&
    plannedSessions.some((plan) => plan.type === "Lifting")
  ) {
    const shoulder = recovery.find((item) => item.area === "Shoulder");
    if (shoulder?.score >= 6)
      warnings.push(
        "Shoulder is already elevated, so keep tennis serving and heavy pressing apart."
      );
  }

  return warnings.length
    ? warnings
    : ["Plan looks balanced enough to run. Keep warmups honest and adjust by readiness."];
};

const getTodayPlanItems = () => {
  const todayDay = new Date().toLocaleDateString(undefined, { weekday: "short" });
  const plannedToday = plannedSessions.filter((plan) => plan.day === todayDay);
  if (plannedToday.length) return plannedToday.slice(0, 2);
  return plannedSessions.slice(0, 2);
};

const getDefaultLiftSets = () => [
  { exercise: "Trap bar deadlift", set: 1, reps: 5, weight: 225, rpe: 7 },
  { exercise: "Trap bar deadlift", set: 2, reps: 5, weight: 245, rpe: 7 },
  { exercise: "Cable chop", set: 3, reps: 10, weight: 35, rpe: 6 },
];

const collectLiftSets = () => {
  if (document.querySelector("#sessionType").value !== "Lifting") return [];
  return [...document.querySelectorAll("[data-lift-row]")].map((row) => ({
    exercise: row.querySelector('[data-lift-field="exercise"]').value,
    set: Number(row.querySelector('[data-lift-field="set"]').value),
    reps: Number(row.querySelector('[data-lift-field="reps"]').value),
    weight: Number(row.querySelector('[data-lift-field="weight"]').value),
    rpe: Number(row.querySelector('[data-lift-field="rpe"]').value),
  }));
};

const updateSessionNotes = () => {
  const sessionType = document.querySelector("#sessionType").value;
  document.querySelector("#notes").value = getTemplate(sessionType).notes || "";
};

const applyTemplate = (type, options = {}) => {
  const template = getTemplate(type);
  if (!options.keepEditing) editingSessionId = null;
  document.querySelector("#sessionType").value = template.type;
  document.querySelector("#duration").value = template.defaultDuration;
  document.querySelector("#effort").value = template.defaultEffort;
  document.querySelector("#outcome").value = template.defaultOutcome;
  document.querySelector("#sessionDate").value = getToday();
  document.querySelectorAll(".practice-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.sessionPreset === template.type);
  });
  renderSportFields(options.values || {});
  renderLiftSets(options.sets || []);
  if (options.note !== undefined) {
    document.querySelector("#notes").value = options.note;
  } else {
    updateSessionNotes();
  }
  updateEditState();
};

const collectFieldValues = (sessionType) => {
  const template = getTemplate(sessionType);
  return template.fields.reduce((values, field) => {
    values[field.id] = document.querySelector(`#${field.id}`).value;
    return values;
  }, {});
};

const updateEditState = () => {
  const editing = Boolean(editingSessionId);
  document.querySelector("#editBanner").hidden = !editing;
  document.querySelector("#saveSessionButton").textContent = editing
    ? "Save changes"
    : "Add to log";
};

const loadSessionForEdit = (sessionId) => {
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return;

  editingSessionId = session.id;
  document.querySelector("#sessionDate").value = session.date;
  document.querySelector("#duration").value = getSessionMinutes(session);
  document.querySelector("#effort").value = getSessionEffort(session);
  document.querySelector("#outcome").value = session.outcome;
  applyTemplate(session.type, {
    keepEditing: true,
    values: session.values,
    sets: session.sets,
    note: session.note,
  });
  document.querySelector("#sessionDate").value = session.date;
  document.querySelector("#duration").value = getSessionMinutes(session);
  document.querySelector("#effort").value = getSessionEffort(session);
  document.querySelector("#outcome").value = session.outcome;
  setView("log");
};

const duplicateSession = (sessionId) => {
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return;

  const duplicated = {
    ...session,
    id: createId(),
    date: getToday(),
    note: `${session.note} Duplicated from ${formatDate(session.date)}.`,
  };
  activeSessionId = duplicated.id;
  store.updateSessions((list) => [duplicated, ...list]);
  showToast("Session duplicated");
};

const saveSessionAsTemplate = (sessionId) => {
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return;

  const template = getTemplate(session.type);
  const title = `${template.title} template`;
  const existing = customDrills.some(
    (drill) => drill.title === title && drill.type === session.type
  );
  const newDrill = {
    id: createDrillId(),
    sport: template.sport,
    type: session.type,
    title: existing ? `${title} ${customDrills.length + 1}` : title,
    tags: [template.sport, session.outcome].filter(Boolean),
    detail: getSessionSummary(session) || template.description,
    cue: session.note || "Repeat the structure, then adjust the target based on readiness.",
    createdAt: getToday(),
  };
  store.updateCustomDrills((list) => [newDrill, ...list]);
  showToast("Session saved as custom template");
};

const deleteSession = (sessionId) => {
  const remaining = sessions.filter((item) => item.id !== sessionId);
  if (activeSessionId === sessionId) {
    activeSessionId = remaining[0]?.id || null;
  }
  if (editingSessionId === sessionId) {
    editingSessionId = null;
    applyTemplate(document.querySelector("#sessionType").value);
  }
  store.updateSessions(() => remaining);
  showToast("Session deleted");
};

const PRIMARY_VIEWS = ["dashboard", "log", "planner", "progress"];

function setMoreNavOpen(open) {
  // Exposed for the More disclosure buttons (onclick in app.html).
  const panel = document.querySelector("#navMore");
  document.querySelectorAll(".nav-more-toggle").forEach((toggle) => {
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (!toggle.querySelector("[data-more-icon]")) {
      toggle.textContent = open ? "Close" : "More";
    }
  });
  if (!panel) return;
  panel.classList.toggle("is-open", open);
  panel.toggleAttribute("hidden", !open);
  panel.setAttribute("aria-hidden", open ? "false" : "true");
}

function syncMoreNav(viewId) {
  const isMore = !PRIMARY_VIEWS.includes(viewId);
  document.querySelectorAll(".nav-more-toggle").forEach((toggle) => {
    toggle.classList.toggle("is-current", isMore);
  });
  // Never auto-open on first paint / dashboard. Only reveal extra rooms
  // after the athlete is already in a More destination.
  if (isMore) setMoreNavOpen(true);
}

function setupMoreNav() {
  document.addEventListener("click", (event) => {
    const toggle = event.target.closest(".nav-more-toggle");
    if (!toggle) return;
    event.preventDefault();
    const panel = document.querySelector("#navMore");
    setMoreNavOpen(!panel?.classList.contains("is-open"));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMoreNavOpen(false);
  });
}

window.setMoreNavOpen = setMoreNavOpen;

const setView = (viewId, options = {}) => {
  document.body.dataset.view = viewId;
  document
    .querySelectorAll(".view")
    .forEach((view) => view.classList.toggle("active", view.id === viewId));
  document.querySelectorAll(".nav-item").forEach((item) => {
    const active = item.dataset.view === viewId;
    item.classList.toggle("active", active);
    item.setAttribute("aria-current", active ? "page" : "false");
  });
  document.querySelectorAll(".bottom-nav-item[data-view]").forEach((item) => {
    const active = item.dataset.view === viewId;
    item.classList.toggle("active", active);
    item.setAttribute("aria-current", active ? "page" : "false");
  });
  syncMoreNav(viewId);
  if (PRIMARY_VIEWS.includes(viewId) && !options.keepMoreOpen) {
    setMoreNavOpen(false);
  }
  if (options.focus) {
    const heading = document.querySelector(`#${viewId} h2`);
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
  }
};

// Single render pass; called on startup and after every store mutation.
// Replaces the cluster of manual render calls that previously had to be
// tacked onto each event handler.
const renderAll = () => {
  renderWeek();
  renderSessionOptions();
  renderHistoryFilters();
  renderProgressFilters();
  renderPlannerControls();
  renderProgramControls();
  renderLibraryFilters();
  renderCustomDrillTypeOptions();
  renderProfile();
  renderTemplates();
  renderDrillLibrary();
  renderSessions();
  renderPrograms();
  renderPlanner();
  renderGoals();
  renderBodyMap();
  renderGolfGps();
  renderDashboard();
  renderProgress();
  renderTimers();
  renderImportPreview();
};

setupMoreNav();
setupEventListeners();
renderAll();
store.subscribe(renderAll);
setView("dashboard");
setMoreNavOpen(false);
applyTemplate(sessionTemplates[0].type);

openAthleteDb()
  .then(() => {
    mirrorStateToDb();
    renderPersistenceStatus(
      "IndexedDB mirror active",
      "Sessions, planner, recovery, goals, and profile are mirrored for stronger browser storage."
    );
  })
  .catch(() => {
    renderPersistenceStatus(
      "Local storage fallback",
      "This browser or file mode is using localStorage only. Export JSON for portable backups."
    );
  });

if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
  navigator.serviceWorker.register("service-worker.js").catch(() => {
    showToast("Offline mode starts when opened from localhost or HTTPS");
  });
}

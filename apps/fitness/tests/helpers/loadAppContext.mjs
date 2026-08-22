import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..", "public");

function readFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

export function createLocalStorageStub(initial = {}) {
  const store = new Map(
    Object.entries(initial).map(([key, value]) => [String(key), String(value)])
  );
  return {
    getItem(key) {
      const stringKey = String(key);
      return store.has(stringKey) ? store.get(stringKey) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
  };
}

// Loads utils.js inside a vm sandbox with a controllable localStorage stub.
// utils.js uses `function` declarations so its members land on the sandbox
// global object directly.
export function loadUtilsContext({ storage = {} } = {}) {
  const sandbox = vm.createContext({
    console,
    localStorage: createLocalStorageStub(storage),
  });
  vm.runInContext(readFile("utils.js"), sandbox, { filename: "utils.js" });
  return sandbox;
}

// Loads utils.js + data.js + analytics.js together so analytics.js sees the
// shared globals it expects from the script-tag environment. Stubs the small
// set of helpers and state vars normally provided by app.js so we can exercise
// analytics without dragging in the DOM.
//
// `state` lets a test seed the store: { sessions, recovery, readinessCheckins,
// plannedSessions, activeGoalId, athleteProfile }.
//
// Returns the sandbox; analytics functions declared as `const` are exposed via
// a postlude that copies them onto globalThis.
const ANALYTICS_EXPORTS = [
  "averageNumbers",
  "formatStatValue",
  "getAdvancedAnalytics",
  "getAnalytics",
  "getGoalProgress",
  "getGolfAnalytics",
  "getGolfSessionAnalysis",
  "getHighestRecoveryFlag",
  "getNumericValue",
  "getPersonalRecords",
  "getProgress",
  "getReadinessScoreFromCheckin",
  "getRecommendation",
  "getRecordValue",
  "getSessionCoachReadout",
  "getSessionScore",
  "getSessionsBySport",
  "getSportCounts",
  "getSportMinutes",
  "getSportProfile",
  "getSportReadiness",
  "getSportRecovery",
  "getTodayCheckin",
  "getTrainingStats",
  "getWeekBuckets",
  "recordDefinitions",
];

export function loadAnalyticsContext(state = {}) {
  const sandbox = vm.createContext({
    console,
    localStorage: createLocalStorageStub(),
  });

  const stubs = `
    var sessions = ${JSON.stringify(state.sessions ?? [])};
    var recovery = ${JSON.stringify(state.recovery ?? [])};
    var readinessCheckins = ${JSON.stringify(state.readinessCheckins ?? [])};
    var plannedSessions = ${JSON.stringify(state.plannedSessions ?? [])};
    var activeGoalId = ${JSON.stringify(state.activeGoalId ?? "clubhead-speed")};
    var athleteProfile = ${JSON.stringify(
      state.athleteProfile ?? {
        primarySport: "Golf",
        activeSports: ["Golf"],
        goalId: "clubhead-speed",
        programId: "golf-power",
      }
    )};

    // Minimal stubs for helpers normally defined in app.js. Real definitions
    // move here once COM-150 extracts state into a store module.
    function getTemplate(type) {
      return sessionTemplates.find((t) => t.type === type) || sessionTemplates[0];
    }
    function getSessionMinutes(session) {
      return Number(session.durationMinutes) || 0;
    }
    function getSessionEffort(session) {
      return Number(session.effortScore) || 0;
    }
    function getGoal(id) {
      return goals.find((g) => g.id === id) || goals[0];
    }
    function getProfileSports() {
      return Array.isArray(athleteProfile.activeSports) ? athleteProfile.activeSports : [];
    }
    function getProfileRecommendedTypes() {
      return [];
    }
    function getPlanSport(plan) {
      return getTemplate(plan.type).sport;
    }
  `;

  const exposeExports = ANALYTICS_EXPORTS.map((name) => `globalThis.${name} = ${name};`).join("\n");

  const program = [
    readFile("utils.js"),
    readFile("data.js"),
    stubs,
    readFile("analytics.js"),
    exposeExports,
  ].join("\n\n");

  vm.runInContext(program, sandbox, { filename: "app-context.js" });
  return sandbox;
}

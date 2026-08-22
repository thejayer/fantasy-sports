// JSDoc @typedef blocks for the core Athlete Log domain entities. Pure
// documentation: this file has no runtime code. Other files reference these
// types via `/** @type {import('./types').Session} */` annotations so TypeScript
// (run as `tsc --checkJs`) catches typo'd field names and shape drift.
//
// Field shapes intentionally lean permissive (most fields optional, `values` is
// a free-form record) because session data varies by sport and templates evolve
// over time. The goal is to catch obvious mistakes, not to over-constrain.

/**
 * @typedef {Object} Session
 * A logged training session.
 * @property {string} id
 * @property {string} date - YYYY-MM-DD local-date key.
 * @property {string} type - Session template type, e.g. "Golf Range Session".
 * @property {number} durationMinutes
 * @property {number} effortScore
 * @property {string} [outcome]
 * @property {Record<string, string | number>} [values] - Sport-specific fields keyed by template field id.
 * @property {LiftSet[]} [sets] - For lifting sessions.
 * @property {string} [note]
 */

/**
 * @typedef {Object} LiftSet
 * @property {string} exercise
 * @property {number} set - 1-indexed set number within the session.
 * @property {number} reps
 * @property {number} weight
 * @property {number} [rpe]
 */

/**
 * @typedef {Object} PlannerEntry
 * A planned (not-yet-completed) session on the weekly board.
 * @property {string} id
 * @property {string} day - One of plannerDays ("Mon"..."Sun").
 * @property {string} type - Session template type.
 * @property {number} durationMinutes
 * @property {"Normal" | "High" | "Low" | string} priority
 * @property {string | null} customDrillId
 */

/**
 * @typedef {Object} RecoveryEntry
 * A single body-area soreness reading.
 * @property {string} area - e.g. "Shoulder", "Knees".
 * @property {number} score - 0-10 inclusive.
 * @property {"Better" | "Same" | "Worse"} [trend] - Optional 7-day trend from the defaults.
 */

/**
 * @typedef {Object} Goal
 * A training outcome the athlete is working toward.
 * @property {string} id
 * @property {string} title
 * @property {string} sport - Primary sport for this goal.
 * @property {string} target - Plain-text target description.
 * @property {string} metric - Metric label used for progress readouts.
 * @property {string[]} relatedSports
 * @property {string[]} recommendedTypes - Session template types that advance the goal.
 * @property {string} copy - Long-form coaching copy.
 */

/**
 * @typedef {Object} Profile
 * The athlete's profile and training preferences.
 * @property {string} [name]
 * @property {string} primarySport
 * @property {string[]} activeSports
 * @property {Record<string, string>} sportPriorities - Sport -> role ("Primary"/"Secondary"/"Support").
 * @property {string} goalId
 * @property {string} [programId]
 * @property {number} weeklyDays
 * @property {string} trainingDays - Comma-separated day labels.
 * @property {string} trainingStyle
 * @property {string} preferredSessionLength
 * @property {string} intensityPreference
 * @property {string} experienceLevel
 * @property {string} access
 * @property {string} otherActivities
 * @property {string} watchAreas
 * @property {string} [note]
 */

/**
 * @typedef {Object} Program
 * A multi-week program blueprint.
 * @property {string} id
 * @property {string} title
 * @property {string} focus
 * @property {string[][]} weeks - Weeks of session template types.
 */

/**
 * @typedef {Object} CustomDrill
 * A user-created reusable session template.
 * @property {string} id
 * @property {string} sport
 * @property {string} type - Session template type this drill spawns.
 * @property {string} title
 * @property {string[]} tags
 * @property {string} detail
 * @property {string} cue
 * @property {string} createdAt - YYYY-MM-DD.
 */

/**
 * @typedef {Object} ReadinessCheckin
 * A daily 5-axis readiness check-in.
 * @property {string} date - YYYY-MM-DD.
 * @property {number} sleep - 0-10.
 * @property {number} soreness - 0-10.
 * @property {number} energy - 0-10.
 * @property {number} stress - 0-10.
 * @property {number} motivation - 0-10.
 * @property {string} [note]
 */

/**
 * @typedef {Object} GolfRoundState
 * In-progress golf GPS round state. Persisted to localStorage between visits.
 * @property {number | null} activeGpsHole
 * @property {number} windAdjustment
 * @property {number} elevationAdjustment
 * @property {number} temperature
 * @property {string | null} startedAt - ISO timestamp.
 * @property {string | null} savedSessionId
 * @property {Record<string, GolfHoleScore>} score - Keyed by hole number.
 */

/**
 * @typedef {Object} GolfHoleScore
 * @property {number} [strokes]
 * @property {number} [putts]
 * @property {number} [fairway]
 * @property {string} [note]
 */

// Mark this file as a module so `import('./types').<Name>` annotations resolve.
// types.js is documentation-only and is not loaded by index.html.
export {};

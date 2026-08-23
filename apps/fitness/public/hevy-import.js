// Hevy workout CSV → Strictly Jayers Fitness lifting sessions.
//
// Official free export: Profile → Settings → Export & Import Data → Export Workouts → CSV.
// Columns vary slightly (weight_kg vs weight_lbs, optional workout_id). No Pro API.

const HEVY_MONTHS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const LBS_PER_KG = 2.2046226218;

function normalizeHevyHeader(name) {
  return String(name || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function parseCsvRecords(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const nextCharacter = input[index + 1];

    if (quoted) {
      if (character === '"' && nextCharacter === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && nextCharacter === "\n") index += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else {
      cell += character;
    }
  }

  if (cell.length || row.length) {
    row.push(cell.trim());
    if (row.some((value) => value !== "")) rows.push(row);
  }
  return rows;
}

function looksLikeHevyHeaders(headers) {
  const names = new Set(headers);
  const hasExercise =
    names.has("exercise_title") || names.has("exercise") || names.has("exercise_name");
  const hasWorkout =
    names.has("start_time") ||
    names.has("title") ||
    names.has("workout_id") ||
    names.has("workout_uuid") ||
    names.has("hevy_id");
  return hasExercise && hasWorkout;
}

function hevyCell(row, ...names) {
  for (const name of names) {
    const value = row[name];
    if (value != null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function parseHevyNumber(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseHevyDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const iso = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (iso) {
    return new Date(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3]),
      Number(iso[4] || 0),
      Number(iso[5] || 0),
      Number(iso[6] || 0),
    );
  }

  const hevy = raw.match(
    /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (hevy) {
    const month = HEVY_MONTHS[hevy[2].slice(0, 3).toLowerCase()];
    if (month != null) {
      return new Date(
        Number(hevy[3]),
        month,
        Number(hevy[1]),
        Number(hevy[4] || 0),
        Number(hevy[5] || 0),
        Number(hevy[6] || 0),
      );
    }
  }

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function hevyDateKey(date) {
  if (typeof getDateKey === "function") return getDateKey(date);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hevyDateStamp(date) {
  if (!date) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hevyDateKey(date)}T${hours}:${minutes}`;
}

function slugHevyPart(value, fallback = "workout") {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

function parseHevyWeightLbs(row) {
  const lbs = parseHevyNumber(
    hevyCell(row, "weight_lbs", "weight_lb", "weightlbs", "lbs"),
  );
  if (lbs != null) return Math.round(lbs * 10) / 10;

  const kg = parseHevyNumber(hevyCell(row, "weight_kg", "weightkg", "kg"));
  if (kg != null) return Math.round(kg * LBS_PER_KG * 10) / 10;

  const weight = parseHevyNumber(hevyCell(row, "weight"));
  if (weight == null) return 0;
  const unit = hevyCell(row, "weight_unit", "unit").toLowerCase();
  if (unit.includes("kg") || unit.includes("kilo")) {
    return Math.round(weight * LBS_PER_KG * 10) / 10;
  }
  return Math.round(weight * 10) / 10;
}

function workoutGroupKey(row) {
  const workoutId = hevyCell(
    row,
    "workout_id",
    "workout_uuid",
    "hevy_id",
    "hevy_workout_id",
  );
  if (workoutId) return `id:${workoutId}`;
  const title = hevyCell(row, "title", "workout_title", "workout_name");
  const start = hevyCell(row, "start_time", "start", "workout_start", "date");
  if (title || start) return `ts:${title}|${start}`;
  return "";
}

function hevyImportKey(workout) {
  if (workout.workoutId) return `hevy:id:${workout.workoutId}`;
  const title = slugHevyPart(workout.title);
  const start = workout.startStamp || slugHevyPart(workout.startRaw, "undated");
  return `hevy:ts:${title}|${start}`;
}

function averageRpe(sets) {
  const values = sets.map((set) => set.rpe).filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sessionDurationMinutes(workout, sets) {
  if (workout.startedAt && workout.endedAt && workout.endedAt > workout.startedAt) {
    return Math.max(1, Math.round((workout.endedAt - workout.startedAt) / 60000));
  }
  const seconds = sets.reduce(
    (sum, set) => sum + (Number(set.durationSeconds) || 0),
    0,
  );
  if (seconds > 0) return Math.max(1, Math.round(seconds / 60));
  return 60;
}

function sessionNote(workout, sets) {
  const parts = [];
  if (workout.title) parts.push(workout.title);
  if (workout.description) parts.push(workout.description);
  const exerciseNotes = [];
  for (const set of sets) {
    if (set.exerciseNotes && !exerciseNotes.includes(set.exerciseNotes)) {
      exerciseNotes.push(`${set.exercise}: ${set.exerciseNotes}`);
    }
  }
  parts.push(...exerciseNotes);
  return parts.join(" — ");
}

function topSetSummary(sets) {
  const working = [...sets].reverse().find((set) => set.weight > 0 || set.reps > 0);
  if (!working) return `${sets.length} sets`;
  const rpe = Number.isFinite(working.rpe) ? ` @ RPE ${working.rpe}` : "";
  return `${working.exercise} ${working.weight}×${working.reps}${rpe}`;
}

function parseHevyCsv(text) {
  const table = parseCsvRecords(text);
  if (table.length < 2) {
    throw new Error("Hevy CSV needs a header row and at least one set");
  }

  const headers = table[0].map(normalizeHevyHeader);
  if (!looksLikeHevyHeaders(headers)) {
    throw new Error(
      "This does not look like a Hevy workout CSV. In Hevy: Profile → Settings → Export & Import Data → Export Workouts → CSV.",
    );
  }

  const groups = new Map();
  for (const cells of table.slice(1)) {
    const row = {};
    headers.forEach((header, index) => {
      if (header && row[header] == null) row[header] = cells[index] ?? "";
    });

    const exercise = hevyCell(row, "exercise_title", "exercise", "exercise_name");
    if (!exercise) continue;

    const groupKey = workoutGroupKey(row);
    if (!groupKey) continue;

    if (!groups.has(groupKey)) {
      const startRaw = hevyCell(row, "start_time", "start", "workout_start", "date");
      const endRaw = hevyCell(row, "end_time", "end", "workout_end");
      const startedAt = parseHevyDate(startRaw);
      const endedAt = parseHevyDate(endRaw);
      groups.set(groupKey, {
        workoutId: hevyCell(
          row,
          "workout_id",
          "workout_uuid",
          "hevy_id",
          "hevy_workout_id",
        ),
        title: hevyCell(row, "title", "workout_title", "workout_name") || "Lifting",
        description: hevyCell(
          row,
          "description",
          "workout_notes",
          "workout_description",
        ),
        startRaw,
        startStamp: hevyDateStamp(startedAt),
        startedAt,
        endedAt,
        rows: [],
      });
    }
    groups.get(groupKey).rows.push(row);
  }

  return [...groups.values()].filter((workout) => workout.rows.length);
}

function hevyRowsToSets(rows) {
  const indexes = rows.map((row) => parseHevyNumber(hevyCell(row, "set_index", "set")));
  const zeroBased = indexes.some((value) => value === 0);

  return rows.map((row, index) => {
    const rawIndex = indexes[index];
    const setNumber =
      rawIndex == null ? index + 1 : zeroBased ? rawIndex + 1 : rawIndex;
    const rpe = parseHevyNumber(hevyCell(row, "rpe"));
    const durationSeconds = parseHevyNumber(
      hevyCell(row, "duration_seconds", "duration"),
    );
    const set = {
      exercise: hevyCell(row, "exercise_title", "exercise", "exercise_name"),
      set: setNumber,
      reps: parseHevyNumber(hevyCell(row, "reps")) || 0,
      weight: parseHevyWeightLbs(row),
      exerciseNotes: hevyCell(row, "exercise_notes", "notes", "note"),
    };
    if (rpe != null) set.rpe = rpe;
    if (durationSeconds != null && durationSeconds > 0) {
      set.durationSeconds = durationSeconds;
    }
    return set;
  });
}

function hevyWorkoutsToSessions(workouts) {
  return (Array.isArray(workouts) ? workouts : [])
    .map((workout) => {
      const sets = hevyRowsToSets(workout.rows || []);
      if (!sets.length) return null;
      const importKey = hevyImportKey(workout);
      const rpe = averageRpe(sets);
      const date = workout.startedAt ? hevyDateKey(workout.startedAt) : hevyDateKey(new Date());
      return {
        id: importKey,
        date,
        type: "Lifting",
        durationMinutes: sessionDurationMinutes(workout, sets),
        effortScore: Math.min(10, Math.max(1, Math.round(rpe || 7))),
        outcome: "Strength PR",
        values: {
          focus: "Full body",
          mainLift: sets[0].exercise,
          topSet: topSetSummary(sets),
          rpe: String(Math.round(rpe || 7)),
          hevyImportKey: importKey,
        },
        sets: sets.map(({ exerciseNotes, ...set }) => set),
        note: sessionNote(workout, sets),
        source: "hevy",
        importKey,
      };
    })
    .filter(Boolean);
}

function hevySessionKeys(session) {
  const keys = [];
  if (session?.importKey) keys.push(session.importKey);
  if (session?.id) keys.push(session.id);
  if (session?.values?.hevyImportKey) keys.push(session.values.hevyImportKey);
  return keys;
}

function mergeHevySessions(existing, incoming) {
  const current = Array.isArray(existing) ? existing : [];
  const nextIncoming = Array.isArray(incoming) ? incoming : [];
  const seen = new Set();
  for (const session of current) {
    for (const key of hevySessionKeys(session)) seen.add(key);
  }

  const added = [];
  let skipped = 0;
  for (const session of nextIncoming) {
    const keys = hevySessionKeys(session);
    if (keys.some((key) => seen.has(key))) {
      skipped += 1;
      continue;
    }
    for (const key of keys) seen.add(key);
    added.push(session);
  }

  return {
    sessions: added.length ? [...added, ...current] : current,
    imported: added.length,
    skipped,
  };
}

function isSignedInFitnessMember(identity) {
  if (!identity || typeof identity !== "object") return false;
  const email =
    identity.user && typeof identity.user.email === "string"
      ? identity.user.email.trim().toLowerCase()
      : "";
  if (!email || !email.includes("@")) return false;
  const prefix = identity.storagePrefix;
  return typeof prefix === "string" && /^athleteLog\.[a-f0-9]{32}$/.test(prefix);
}

const getSportCounts = () =>
  sessions.reduce((counts, session) => {
    const sport = getTemplate(session.type).sport;
    counts[sport] = (counts[sport] || 0) + 1;
    return counts;
  }, {});

const getHighestRecoveryFlag = () =>
  recovery.reduce((highest, item) => (item.score > highest.score ? item : highest), recovery[0]);

const getTodayCheckin = () =>
  readinessCheckins.find((checkin) => checkin.date === getToday()) || null;

const getReadinessScoreFromCheckin = (checkin = getTodayCheckin()) => {
  if (!checkin) return null;
  const positive =
    Number(checkin.sleep) * 2.2 + Number(checkin.energy) * 2.4 + Number(checkin.motivation) * 1.5;
  const negative = Number(checkin.soreness) * 2.1 + Number(checkin.stress) * 1.8;
  return Math.max(25, Math.min(98, Math.round(58 + positive - negative)));
};

const getTrainingStats = () => {
  const totalMinutes = sessions.reduce((sum, session) => sum + getSessionMinutes(session), 0);
  const averageEffort = sessions.length
    ? sessions.reduce((sum, session) => sum + getSessionEffort(session), 0) / sessions.length
    : 0;
  const sportCounts = getSportCounts();
  const highestFlag = getHighestRecoveryFlag();
  const recoveryPenalty = recovery.reduce((sum, item) => sum + Math.max(0, item.score - 4), 0) * 3;
  const effortPenalty = Math.max(0, averageEffort - 6) * 5;
  const loadPenalty = Math.max(0, totalMinutes / 60 - 8) * 2;
  const baseReadiness = Math.max(
    35,
    Math.round(92 - recoveryPenalty - effortPenalty - loadPenalty)
  );
  const checkinReadiness = getReadinessScoreFromCheckin();
  const readiness =
    checkinReadiness === null
      ? baseReadiness
      : Math.round(baseReadiness * 0.55 + checkinReadiness * 0.45);

  return {
    totalMinutes,
    totalHours: totalMinutes / 60,
    averageEffort,
    sportCounts,
    sportCount: Object.keys(sportCounts).length,
    highestFlag,
    readiness,
    baseReadiness,
    checkinReadiness,
  };
};

const getSportProfile = (sport) =>
  sportProfiles.find((profile) => profile.sport === sport) || sportProfiles[0];

const getSessionsBySport = (sport) =>
  sessions.filter((session) => getTemplate(session.type).sport === sport);

const getSportMinutes = (sport) =>
  getSessionsBySport(sport).reduce((sum, session) => sum + getSessionMinutes(session), 0);

const getSportRecovery = (profile) => {
  const flags = profile.watch
    .map((area) => recovery.find((item) => item.area === area))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return flags[0] || getHighestRecoveryFlag();
};

const getSportReadiness = (profile, sportSessions) => {
  const recoveryFlag = getSportRecovery(profile);
  const averageEffort = sportSessions.length
    ? sportSessions.reduce((sum, session) => sum + getSessionEffort(session), 0) /
      sportSessions.length
    : 0;
  return Math.max(
    35,
    Math.min(
      96,
      Math.round(
        92 - recoveryFlag.score * 4 - Math.max(0, averageEffort - 6) * 4 + sportSessions.length * 2
      )
    )
  );
};

const getSessionCoachReadout = (session) => {
  const template = getTemplate(session.type);
  const profile = getSportProfile(template.sport);
  const flag = getSportRecovery(profile);
  const effort = getSessionEffort(session);

  if (flag.score >= 7) {
    return `${flag.area} is elevated at ${flag.score}/10, so repeat this only if the warmup feels clean and keep intensity controlled.`;
  }

  if (effort >= 8) {
    return "High effort session. The next training choice should either be technical, easy aerobic, or mobility-biased.";
  }

  if (template.sport === "Golf") {
    return "Good golf-specific input. Track whether this improved ball flight, scoring choices, or speed intent next time.";
  }

  if (["Tennis", "Pickleball"].includes(template.sport)) {
    return "Court volume is useful, but the value comes from repeatable footwork and clean deceleration as much as shot count.";
  }

  return "This supports the bigger sport goal when it leaves you fresher for skill work, not just more tired.";
};

const getSessionScore = (session) => {
  const template = getTemplate(session.type);
  const effort = getSessionEffort(session);
  const duration = getSessionMinutes(session);
  const fieldValues = Object.values(session.values || {}).filter((value) =>
    String(value || "").trim()
  ).length;
  const durationTarget = Math.min(
    22,
    Math.round((duration / Math.max(20, template.defaultDuration)) * 18)
  );
  const effortScore = Math.max(4, 22 - Math.abs(effort - 7) * 3);
  const structureScore = Math.min(22, fieldValues * 4 + (session.sets?.length ? 6 : 0));
  const goalScore = getGoal(activeGoalId).relatedSports.includes(template.sport) ? 18 : 10;
  const noteScore = session.note?.trim().length > 20 ? 16 : 8;
  const score = Math.max(
    35,
    Math.min(100, durationTarget + effortScore + structureScore + goalScore + noteScore)
  );
  let label = "Solid";
  if (score >= 88) label = "Excellent";
  else if (score >= 74) label = "Strong";
  else if (score < 58) label = "Light";

  return {
    score,
    label,
    detail: `${template.sport} quality ${label.toLowerCase()}: ${duration} min, effort ${effort}/10, ${fieldValues} tracked fields.`,
  };
};

const getNumericValue = (session, field) => {
  const value = Number.parseFloat(session.values?.[field]);
  return Number.isFinite(value) ? value : null;
};

const averageNumbers = (values) => {
  const cleanValues = values.filter((value) => Number.isFinite(value));
  if (!cleanValues.length) return null;
  return cleanValues.reduce((sum, value) => sum + value, 0) / cleanValues.length;
};

const formatStatValue = (value, suffix = "", decimals = 0) => {
  if (!Number.isFinite(value)) return "--";
  const rounded = decimals ? value.toFixed(decimals) : Math.round(value);
  return `${rounded}${suffix}`;
};

const getGolfAnalytics = () => {
  const golfSessions = getSessionsBySport("Golf");
  const rangeSessions = sessions.filter((session) => session.type === "Golf Range Session");
  const shortGameSessions = sessions.filter((session) => session.type === "Golf Short Game");
  const rounds = sessions.filter((session) => session.type === "Golf Round");
  const recentRounds = rounds.slice(0, 5);
  const recentRange = rangeSessions.slice(0, 5);
  const recentShortGame = shortGameSessions.slice(0, 5);
  const averageScore = averageNumbers(
    recentRounds.map((session) => getNumericValue(session, "score"))
  );
  const averagePutts = averageNumbers(
    recentRounds.map((session) => getNumericValue(session, "putts"))
  );
  const averageFairways = averageNumbers(
    recentRounds.map((session) => getNumericValue(session, "fairways"))
  );
  const averageGir = averageNumbers(
    recentRounds.map((session) => getNumericValue(session, "greens"))
  );
  const averagePenalties = averageNumbers(
    recentRounds.map((session) => getNumericValue(session, "penalties"))
  );
  const averageRangeQuality = averageNumbers(
    recentRange.map((session) => getNumericValue(session, "quality"))
  );
  const averageTargetRate = averageNumbers(
    recentRange.map((session) => getNumericValue(session, "targetRate"))
  );
  const averageShortGame = averageNumbers(
    recentShortGame.map((session) => getNumericValue(session, "upDownRate"))
  );
  const averageProximity = averageNumbers(
    recentShortGame.map((session) => getNumericValue(session, "proximity"))
  );
  const missCounts = golfSessions.reduce((counts, session) => {
    const miss = session.values?.missPattern || session.values?.startLine;
    if (miss) counts[miss] = (counts[miss] || 0) + 1;
    return counts;
  }, {});
  const primaryMiss =
    Object.entries(missCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "No miss pattern yet";
  const practiceMix = [
    { label: "Range", value: rangeSessions.length },
    { label: "Short game", value: shortGameSessions.length },
    { label: "Rounds", value: rounds.length },
  ];
  const totalPractice = practiceMix.reduce((sum, item) => sum + item.value, 0) || 1;
  const scoringRisk =
    (averagePenalties || 0) * 2 +
    Math.max(0, (averagePutts || 32) - 32) +
    Math.max(0, 8 - (averageGir || 8));
  const focus =
    scoringRisk >= 7
      ? "Scoring leak: clean up penalties, putting, and approach misses before adding more speed work."
      : averageShortGame !== null && averageShortGame < 45
        ? "Short-game priority: up-and-down conversion is the biggest available scoring lever."
        : averageRangeQuality !== null && averageRangeQuality < 7
          ? "Range priority: contact and target success need more reps before taking it to the course."
          : "Balanced golf signal: keep rotating range, short game, and on-course decision reps.";

  return {
    golfSessions,
    rangeSessions,
    shortGameSessions,
    rounds,
    averageScore,
    averagePutts,
    averageFairways,
    averageGir,
    averagePenalties,
    averageRangeQuality,
    averageTargetRate,
    averageShortGame,
    averageProximity,
    primaryMiss,
    practiceMix,
    totalPractice,
    focus,
  };
};

const getGolfSessionAnalysis = (session) => {
  const template = getTemplate(session.type);
  if (template.sport !== "Golf") return null;

  if (session.type === "Golf Round") {
    const score = getNumericValue(session, "score");
    const fairways = getNumericValue(session, "fairways");
    const greens = getNumericValue(session, "greens");
    const putts = getNumericValue(session, "putts");
    const penalties = getNumericValue(session, "penalties");
    const threePutts = getNumericValue(session, "threePutts");
    const upDowns = getNumericValue(session, "upDowns");
    const fairwayRate = fairways === null ? null : (fairways / 14) * 100;
    const girRate = greens === null ? null : (greens / 18) * 100;
    const scoringLeak =
      (penalties || 0) * 2 + (threePutts || 0) * 1.5 + Math.max(0, (putts || 32) - 32);
    return {
      title: "Round scorecard",
      summary: score
        ? `${score} with ${formatStatValue(fairwayRate, "%")} fairways and ${formatStatValue(girRate, "%")} GIR.`
        : "Round logged. Add score, fairways, greens, and putts to unlock a stronger scorecard.",
      cue:
        scoringLeak >= 6
          ? "Next round: play away from penalty trouble and choose lag-putt speed targets before line."
          : "Next round: keep the same decision discipline and look for one aggressive scoring window per side.",
      stats: [
        { label: "Fairway rate", value: formatStatValue(fairwayRate, "%") },
        { label: "GIR rate", value: formatStatValue(girRate, "%") },
        { label: "Putts", value: formatStatValue(putts) },
        { label: "Up-and-downs", value: formatStatValue(upDowns) },
      ],
    };
  }

  if (session.type === "Golf Short Game") {
    const upDownRate = getNumericValue(session, "upDownRate");
    const proximity = getNumericValue(session, "proximity");
    const pressure = getNumericValue(session, "pressure");
    return {
      title: "Short-game pressure",
      summary: `${formatStatValue(upDownRate, "%")} up-and-down rate, ${formatStatValue(proximity, " ft")} average proximity, pressure ${formatStatValue(pressure, "/10")}.`,
      cue:
        upDownRate !== null && upDownRate < 45
          ? "Next practice: repeat this from uneven lies and make the first putt matter."
          : "Next practice: keep pressure scoring and add harder lies before increasing volume.",
      stats: [
        { label: "Up-and-down", value: formatStatValue(upDownRate, "%") },
        { label: "Proximity", value: formatStatValue(proximity, " ft") },
        { label: "Pressure", value: formatStatValue(pressure, "/10") },
        { label: "Focus", value: session.values?.focus || "--" },
      ],
    };
  }

  const targetRate = getNumericValue(session, "targetRate");
  const quality = getNumericValue(session, "quality");
  const dispersion = getNumericValue(session, "dispersion");
  const leftMisses = getNumericValue(session, "leftMisses") || 0;
  const rightMisses = getNumericValue(session, "rightMisses") || 0;
  const shortMisses = getNumericValue(session, "shortMisses") || 0;
  const missTotal = leftMisses + rightMisses + shortMisses;
  const directionalMiss = [
    { label: "left", value: leftMisses },
    { label: "right", value: rightMisses },
    { label: "short", value: shortMisses },
  ].sort((a, b) => b.value - a.value)[0];
  return {
    title: "Range pattern",
    summary: `${formatStatValue(targetRate, "%")} target success, strike ${formatStatValue(quality, "/10")}, ${formatStatValue(dispersion, " yd")} dispersion${missTotal ? `, ${Math.round((directionalMiss.value / missTotal) * 100)}% ${directionalMiss.label} miss` : ""}.`,
    cue: session.values?.missPattern
      ? `Next range block: start with the ${session.values.missPattern.toLowerCase()} miss and make the correction measurable.`
      : "Next range block: log start line and miss pattern to sharpen the prescription.",
    stats: [
      { label: "Target rate", value: formatStatValue(targetRate, "%") },
      { label: "Strike", value: formatStatValue(quality, "/10") },
      { label: "Dispersion", value: formatStatValue(dispersion, " yd") },
      { label: "Miss", value: session.values?.missPattern || "--" },
    ],
  };
};

const recordDefinitions = [
  {
    title: "Biggest range session",
    sport: "Golf",
    type: "Golf Range Session",
    field: "balls",
    mode: "max",
    unit: " balls",
  },
  {
    title: "Best strike quality",
    sport: "Golf",
    type: "Golf Range Session",
    field: "quality",
    mode: "max",
    unit: "/10",
  },
  {
    title: "Best target rate",
    sport: "Golf",
    type: "Golf Range Session",
    field: "targetRate",
    mode: "max",
    unit: "%",
  },
  {
    title: "Best up-and-down rate",
    sport: "Golf",
    type: "Golf Short Game",
    field: "upDownRate",
    mode: "max",
    unit: "%",
  },
  {
    title: "Closest short-game proximity",
    sport: "Golf",
    type: "Golf Short Game",
    field: "proximity",
    mode: "min",
    unit: " ft",
  },
  {
    title: "Lowest golf score",
    sport: "Golf",
    type: "Golf Round",
    field: "score",
    mode: "min",
    unit: "",
  },
  {
    title: "Most fairways hit",
    sport: "Golf",
    type: "Golf Round",
    field: "fairways",
    mode: "max",
    unit: " FIR",
  },
  {
    title: "Biggest ball machine day",
    sport: "Tennis",
    type: "Tennis Ball Machine",
    field: "balls",
    mode: "max",
    unit: " balls",
  },
  {
    title: "Best tennis consistency",
    sport: "Tennis",
    type: "Tennis Ball Machine",
    field: "consistency",
    mode: "max",
    unit: "/10",
  },
  {
    title: "Best serve quality",
    sport: "Tennis",
    type: "Tennis Match",
    field: "serveQuality",
    mode: "max",
    unit: "/10",
  },
  {
    title: "Most pickleball games",
    sport: "Pickleball",
    type: "Pickleball Match",
    field: "games",
    mode: "max",
    unit: " games",
  },
  {
    title: "Best reset quality",
    sport: "Pickleball",
    type: "Pickleball Match",
    field: "resetQuality",
    mode: "max",
    unit: "/10",
  },
  {
    title: "Lowest knee fatigue",
    sport: "Pickleball",
    type: "Pickleball Match",
    field: "kneeFatigue",
    mode: "min",
    unit: "/10",
  },
  {
    title: "Longest run",
    sport: "Endurance",
    type: "Running",
    field: "distance",
    mode: "max",
    unit: " mi",
  },
  {
    title: "Longest lift",
    sport: "Strength",
    type: "Lifting",
    field: "durationMinutes",
    mode: "max",
    unit: " min",
  },
];

const getRecordValue = (session, field) => {
  const rawValue =
    field === "durationMinutes" ? getSessionMinutes(session) : session.values?.[field];
  const value = Number.parseFloat(rawValue);
  return Number.isFinite(value) ? value : null;
};

const getPersonalRecords = () =>
  recordDefinitions.map((definition) => {
    const matchingSessions = sessions
      .filter((session) => session.type === definition.type)
      .map((session) => ({ session, value: getRecordValue(session, definition.field) }))
      .filter((item) => item.value !== null);

    if (!matchingSessions.length) return { ...definition, value: null, session: null };

    const best = matchingSessions.reduce((record, item) => {
      if (!record) return item;
      return definition.mode === "min"
        ? item.value < record.value
          ? item
          : record
        : item.value > record.value
          ? item
          : record;
    }, null);

    return { ...definition, value: best.value, session: best.session };
  });

const getGoalProgress = (goal = getGoal(activeGoalId)) => {
  const relatedSessions = sessions.filter((session) =>
    goal.relatedSports.includes(getTemplate(session.type).sport)
  );
  const relatedPlans = plannedSessions.filter((plan) =>
    goal.relatedSports.includes(getPlanSport(plan))
  );
  const completedMinutes = relatedSessions.reduce(
    (sum, session) => sum + getSessionMinutes(session),
    0
  );
  const plannedMinutes = relatedPlans.reduce((sum, plan) => sum + plan.durationMinutes, 0);
  const recoveryPenalty =
    goal.id === "serve-durability"
      ? (recovery.find((item) => item.area === "Shoulder")?.score || 0) * 3
      : goal.id === "knee-resilience"
        ? (recovery.find((item) => item.area === "Knees")?.score || 0) * 3
        : 0;
  const progress = Math.min(
    100,
    Math.max(
      8,
      Math.round(
        (completedMinutes / 300) * 52 +
          (plannedMinutes / 240) * 32 -
          recoveryPenalty +
          relatedSessions.length * 3
      )
    )
  );

  return {
    progress,
    completedSessions: relatedSessions.length,
    plannedSessions: relatedPlans.length,
    completedMinutes,
    plannedMinutes,
  };
};

const getWeekBuckets = () => {
  const today = new Date();
  return [3, 2, 1, 0].map((weeksAgo) => {
    const end = new Date(today);
    end.setDate(today.getDate() - weeksAgo * 7);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    const startKey = getDateKey(start);
    const endKey = getDateKey(end);
    const weekSessions = sessions.filter(
      (session) => session.date >= startKey && session.date <= endKey
    );
    return {
      label: weeksAgo === 0 ? "This week" : `${weeksAgo}w ago`,
      minutes: weekSessions.reduce((sum, session) => sum + getSessionMinutes(session), 0),
      count: weekSessions.length,
    };
  });
};

const getAnalytics = () => {
  const stats = getTrainingStats();
  const goal = getGoal(activeGoalId);
  const goalProgress = getGoalProgress(goal);
  const weekBuckets = getWeekBuckets();
  const sportCounts = getSportCounts();
  const highestWeek = Math.max(60, ...weekBuckets.map((week) => week.minutes));
  const recoveryAverage = recovery.reduce((sum, item) => sum + item.score, 0) / recovery.length;

  return {
    stats,
    goal,
    goalProgress,
    weekBuckets,
    sportCounts,
    highestWeek,
    recoveryAverage,
  };
};

const getAdvancedAnalytics = () => {
  const analytics = getAnalytics();
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 6);
  const sevenDayKey = getDateKey(sevenDaysAgo);
  const activeDates = new Set(
    sessions.filter((session) => session.date >= sevenDayKey).map((session) => session.date)
  );
  const completedFromPlanner = sessions.filter((session) =>
    session.note?.includes("Completed from weekly planner")
  ).length;
  const planDenominator = completedFromPlanner + plannedSessions.length;
  const completionRate = planDenominator
    ? Math.round((completedFromPlanner / planDenominator) * 100)
    : 0;
  const currentWeek = analytics.weekBuckets.at(-1).minutes;
  const chronicAverage =
    analytics.weekBuckets.reduce((sum, week) => sum + week.minutes, 0) /
    Math.max(1, analytics.weekBuckets.length);
  const loadRatio = chronicAverage ? currentWeek / chronicAverage : 0;
  const sorenessLoad = recovery.filter((item) => item.score >= 6).length;
  const highEffortSessions = sessions.filter((session) => getSessionEffort(session) >= 8).length;
  const recordCount = getPersonalRecords().filter((record) => record.session).length;
  const focusSport = athleteProfile.primarySport || analytics.goal.sport;
  const focusSessions = sessions.filter(
    (session) => getTemplate(session.type).sport === focusSport
  ).length;

  return [
    {
      label: "7-day consistency",
      value: `${activeDates.size}/7`,
      detail:
        activeDates.size >= 4
          ? "Enough touch points to keep skill sharp."
          : "Add one short practice or recovery session to keep momentum.",
    },
    {
      label: "Planner completion",
      value: planDenominator ? `${completionRate}%` : "New",
      detail: planDenominator
        ? `${completedFromPlanner} planned sessions have turned into log entries.`
        : "Load a plan and complete sessions to start tracking adherence.",
    },
    {
      label: "Acute to chronic load",
      value: loadRatio ? `${loadRatio.toFixed(1)}x` : "0.0x",
      detail:
        loadRatio > 1.35
          ? "Current week is running hot against the four-week average."
          : "Load is in a workable range against recent history.",
    },
    {
      label: "Soreness pressure",
      value: `${sorenessLoad}`,
      detail: `${highEffortSessions} high-effort sessions in the log; watch elevated recovery flags before stacking intensity.`,
    },
    {
      label: "Record coverage",
      value: `${recordCount}/${recordDefinitions.length}`,
      detail:
        "More structured entries unlock more PRs for golf, court sports, endurance, and lifting.",
    },
    {
      label: "Primary sport signal",
      value: `${focusSessions}`,
      detail: `${focusSport} sessions are feeding the recommendation engine.`,
    },
  ];
};

const getProgress = () => {
  const stats = getTrainingStats();
  const golfCount = stats.sportCounts.Golf || 0;
  const tennisCount = stats.sportCounts.Tennis || 0;
  const pickleballCount = stats.sportCounts.Pickleball || 0;
  const enduranceCount = stats.sportCounts.Endurance || 0;
  const strengthCount = stats.sportCounts.Strength || 0;
  const shoulder = recovery.find((item) => item.area === "Shoulder")?.score || 1;

  return [
    { label: "Golf skill volume", value: Math.min(100, golfCount * 22) },
    { label: "Tennis court work", value: Math.min(100, tennisCount * 25) },
    { label: "Pickleball durability", value: Math.min(100, pickleballCount * 24) },
    { label: "Endurance base", value: Math.min(100, enduranceCount * 30) },
    { label: "Shoulder durability", value: Math.max(15, 100 - shoulder * 9) },
    { label: "Strength consistency", value: Math.min(100, strengthCount * 35) },
  ];
};

const getRecommendation = (stats) => {
  const flag = stats.highestFlag;
  const goal = getGoal(activeGoalId);
  const activeSports = getProfileSports();
  const primarySport = athleteProfile.primarySport || goal.sport;
  const primaryProfile = getSportProfile(primarySport);
  const profileTypes = getProfileRecommendedTypes();
  const preferredTemplate = getTemplate(
    profileTypes[0] || primaryProfile.nextTypes[0] || goal.recommendedTypes[0]
  );

  if (flag.score >= 7 && ["Shoulder", "Elbow", "Wrist"].includes(flag.area)) {
    return {
      type: "Recovery",
      title: "Lower-body aerobic base + shoulder care",
      text: `${flag.area} is at ${flag.score}/10, so keep pressing, serving, and high-volume swings light today.`,
    };
  }

  if (flag.score >= 7 && ["Knees", "Ankles", "Hips"].includes(flag.area)) {
    return {
      type: "Recovery",
      title: "Mobility reset + upper strength",
      text: `${flag.area} is the top flag, so avoid hard court volume and give lower-body tissues room to calm down.`,
    };
  }

  const checkin = getTodayCheckin();
  if (checkin && stats.checkinReadiness !== null && stats.checkinReadiness < 62) {
    return {
      type: "Readiness",
      title: "Technique work or recovery bias",
      text: `Today's check-in is pulling readiness down. Keep intensity honest: sleep ${checkin.sleep}/10, soreness ${checkin.soreness}/10, energy ${checkin.energy}/10.`,
    };
  }

  if (!stats.sportCounts[primarySport]) {
    return {
      type: `${primarySport} Focus`,
      title: preferredTemplate.title,
      text: `${primarySport} is set as your primary sport. Start with ${preferredTemplate.title.toLowerCase()} so the app can tune volume, recovery flags, and future suggestions around how you actually train.`,
    };
  }

  if (activeSports.includes("Endurance") && !stats.sportCounts.Endurance) {
    return {
      type: "Endurance",
      title: "Zone 2 base builder",
      text: "Endurance is part of your profile, but no aerobic work is logged yet. A relaxed run, ride, or swim would round out the week.",
    };
  }

  if (activeSports.includes("Strength") && !stats.sportCounts.Strength) {
    return {
      type: "Strength",
      title: "Full-body strength session",
      text: "Strength is in your profile, but strength consistency is missing. Keep it crisp, joint-friendly, and supportive of your sport work.",
    };
  }

  if (athleteProfile.trainingStyle === "Skill-first") {
    return {
      type: `${primarySport} Skill`,
      title: preferredTemplate.title,
      text: `Your profile is skill-first, so prioritize a measured ${primarySport.toLowerCase()} session before adding more conditioning volume.`,
    };
  }

  if (athleteProfile.trainingStyle === "Longevity" && flag.score >= 5) {
    return {
      type: "Longevity",
      title: "Technique plus recovery buffer",
      text: `${flag.area} is at ${flag.score}/10 and your profile leans longevity, so keep quality high and leave room for tissue recovery.`,
    };
  }

  if (goal.id === "clubhead-speed") {
    return {
      type: "Golf Power",
      title: "Speed intent + lower-body power",
      text: "Your primary goal is clubhead speed, so pair a focused range session with explosive but low-volume lifting.",
    };
  }

  if (goal.id === "lower-handicap") {
    const golf = getGolfAnalytics();
    return {
      type: "Golf Scoring",
      title:
        golf.averageShortGame !== null && golf.averageShortGame < 45
          ? "Short-game scoring ladder"
          : "Decision round + wedge calibration",
      text: golf.focus,
    };
  }

  if (goal.id === "serve-durability") {
    return {
      type: "Tennis Durability",
      title: "Serve mechanics + shoulder capacity",
      text: "Your goal points toward controlled tennis reps, scap work, and avoiding heavy pressing near serve-heavy days.",
    };
  }

  if (goal.id === "knee-resilience") {
    return {
      type: "Court Durability",
      title: "Knee-friendly strength + controlled court work",
      text: "Prioritize deceleration, calf capacity, and measured pickleball volume before stacking hard matches.",
    };
  }

  if (goal.id === "aerobic-base") {
    return {
      type: "Endurance",
      title: "Easy aerobic volume",
      text: "Keep intensity conversational and build steady volume that helps recovery and late-session stamina.",
    };
  }

  return {
    type: "Golf Strength",
    title: "Rotational power + shoulder resilience",
    text: "Training mix and recovery look workable. Pair power work with mobility and stop short of grindy reps.",
  };
};

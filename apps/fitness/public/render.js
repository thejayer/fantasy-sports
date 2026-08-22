// @ts-nocheck -- 1356 lines of DOM template rendering; type cleanup deferred
// until COM-89 splits the renderer into feature modules and COM-150 supplies
// a typed store the renderer can subscribe to.
const renderPersistenceStatus = (
  title = "Local storage ready",
  detail = "Browser backup is available on this device."
) => {
  const status = document.querySelector("#persistenceStatus");
  if (!status) return;
  status.innerHTML = `
    <span>Storage</span>
    <strong>${escapeHtml(title)}</strong>
    <p>${escapeHtml(detail)}</p>
  `;
};

const renderImportPreview = () => {
  const source = document.querySelector("#importSource").value;
  const input = document.querySelector("#importMappingText").value.trim();
  const container = document.querySelector("#importPreview");
  if (!input) {
    container.innerHTML = `<article class="empty-state compact"><strong>No rows pasted yet</strong><p>Paste a header row and a few activity rows from ${escapeHtml(source)} to preview mapping.</p></article>`;
    return;
  }

  const rows = parseCsvPreview(input);
  if (!rows.length) {
    container.innerHTML = `<article class="empty-state compact error"><strong>Could not read rows</strong><p>Use simple CSV text with a header row like date,type,duration,distance,name.</p></article>`;
    return;
  }

  container.innerHTML = `
    <div class="import-preview-list">
      ${rows
        .map(
          (row) => `
        <article>
          <strong>${escapeHtml(row.type || "Activity")}</strong>
          <span>${escapeHtml(row.date || "No date")} - ${escapeHtml(row.duration || "No duration")}${row.distance ? ` - ${escapeHtml(row.distance)}` : ""}</span>
          <p>${escapeHtml(row.notes || `${source} activity ready for manual review`)}</p>
        </article>
      `
        )
        .join("")}
    </div>
  `;
  showToast("Import mapping preview generated");
};

const renderWeek = () => {
  document.querySelector("#weekPlan").innerHTML = weekPlan
    .map(
      (item) => `
    <article class="week-day">
      <strong>${item.day}</strong>
      <div>
        <strong>${item.title}</strong>
        <span>${item.detail}</span>
      </div>
      <span class="tag">${item.tag}</span>
    </article>
  `
    )
    .join("");
};

const renderSessions = () => {
  const visibleSessions = getFilteredSessions();
  document.querySelector("#historyCount").textContent =
    `${visibleSessions.length} ${visibleSessions.length === 1 ? "session" : "sessions"}`;
  if (!visibleSessions.length) {
    document.querySelector("#sessionDetailPanel").hidden = true;
    document.querySelector("#sessionList").innerHTML = `
      <article class="empty-state">
        <strong>No sessions match this view</strong>
        <p>Clear the filters or log a range session, ball machine workout, lift, run, or match to start building history.</p>
        <button class="primary-button" data-view-jump="log" type="button">Log session</button>
      </article>
    `;
    renderSportDashboards();
    renderDashboard();
    renderProgress();
    renderCalendar();
    renderCompareOptions();
    renderGoals();
    return;
  }
  if (!visibleSessions.some((session) => session.id === activeSessionId)) {
    activeSessionId = visibleSessions[0]?.id || null;
  }
  document.querySelector("#sessionList").innerHTML = visibleSessions
    .map(
      (item) => `
    <article class="session-card ${item.id === activeSessionId ? "active" : ""}" data-session-open="${item.id}">
      <div class="session-date">
        <strong>${formatDate(item.date)}</strong>
        <span>${getTemplate(item.type).sport}</span>
      </div>
      <div>
        <strong>${escapeHtml(item.type)}</strong>
        <p>${escapeHtml(getSessionSummary(item))}</p>
        <div class="session-meta">
          <span>${getSessionMinutes(item)} min</span>
          <span>${getSessionEffort(item)}/10 effort</span>
          <span>${getSessionScore(item).score} score</span>
          <span>${escapeHtml(item.outcome)}</span>
        </div>
      </div>
      <div class="session-actions">
        <button class="ghost-button" data-session-action="view" data-session-id="${item.id}" type="button">View</button>
        <button class="ghost-button" data-session-action="edit" data-session-id="${item.id}" type="button">Edit</button>
        <button class="ghost-button" data-session-action="duplicate" data-session-id="${item.id}" type="button">Duplicate</button>
        <button class="ghost-button danger-button" data-session-action="delete" data-session-id="${item.id}" type="button">Delete</button>
      </div>
    </article>
  `
    )
    .join("");
  renderSessionDetail();
  renderSportDashboards();
  renderDashboard();
  renderProgress();
  renderCalendar();
  renderCompareOptions();
  renderGoals();
};

const renderSessionDetail = () => {
  const panel = document.querySelector("#sessionDetailPanel");
  const session = sessions.find((item) => item.id === activeSessionId);
  if (!session) {
    panel.hidden = true;
    return;
  }

  const template = getTemplate(session.type);
  const profile = getSportProfile(template.sport);
  const sessionScore = getSessionScore(session);
  const relatedSessions = sessions
    .filter((item) => item.id !== session.id && getTemplate(item.type).sport === template.sport)
    .slice(0, 3);
  const fields = template.fields
    .map((field) => {
      const value = session.values?.[field.id];
      return value
        ? `<div class="detail-stat"><span>${field.label}</span><strong>${escapeHtml(value)}${field.unit ? ` ${field.unit}` : ""}</strong></div>`
        : "";
    })
    .filter(Boolean)
    .join("");
  const setSummary = session.sets?.length
    ? `
    <div class="lift-set-summary">
      <p class="eyebrow">Set Log</p>
      ${session.sets
        .map(
          (set) => `
        <div class="compare-row">
          <span>${escapeHtml(set.exercise || "Exercise")}</span>
          <span>${set.reps || 0} reps @ ${set.weight || 0}</span>
          <span>RPE ${set.rpe || "-"}</span>
        </div>
      `
        )
        .join("")}
    </div>
  `
    : "";
  const golfAnalysis = getGolfSessionAnalysis(session);
  const golfPanel = golfAnalysis
    ? `
    <div class="golf-analysis-card">
      <p class="eyebrow">${escapeHtml(golfAnalysis.title)}</p>
      <p>${escapeHtml(golfAnalysis.summary)}</p>
      <div class="golf-stat-grid">
        ${golfAnalysis.stats
          .map(
            (stat) => `
          <div><span>${escapeHtml(stat.label)}</span><strong>${escapeHtml(stat.value)}</strong></div>
        `
          )
          .join("")}
      </div>
      <p>${escapeHtml(golfAnalysis.cue)}</p>
    </div>
  `
    : "";
  let gpsScorecard = "";
  if (session.type === "Golf Round" && session.values?.gpsHoles) {
    try {
      const gpsHoles = JSON.parse(session.values.gpsHoles);
      gpsScorecard = `
        <div class="gps-saved-scorecard">
          <p class="eyebrow">Saved GPS Scorecard</p>
          <div class="gps-scorecard compact">
            ${golfGpsCourse.holes
              .map(
                (hole) => `
              <div>
                <span>${hole.number}</span>
                <strong>${escapeHtml(gpsHoles[hole.number]?.strokes || "-")}</strong>
                <small>${escapeHtml(gpsHoles[hole.number]?.club || "Club")}</small>
              </div>
            `
              )
              .join("")}
          </div>
        </div>
      `;
    } catch (_error) {
      gpsScorecard = "";
    }
  }

  panel.hidden = false;
  panel.innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Session Detail</p>
        <h3>${escapeHtml(session.type)}</h3>
      </div>
      <div class="detail-actions">
        <button class="ghost-button" data-session-action="template" data-session-id="${session.id}" type="button">Save as template</button>
        <button class="ghost-button" data-session-action="duplicate" data-session-id="${session.id}" type="button">Repeat</button>
      </div>
    </div>
    <div class="session-detail-grid">
      <div class="session-detail-main">
        <div class="detail-kpis">
          <div class="detail-stat"><span>Date</span><strong>${formatDate(session.date)}</strong></div>
          <div class="detail-stat"><span>Duration</span><strong>${getSessionMinutes(session)} min</strong></div>
          <div class="detail-stat"><span>Effort</span><strong>${getSessionEffort(session)}/10</strong></div>
          <div class="detail-stat score-stat"><span>Session score</span><strong>${sessionScore.score}</strong></div>
          <div class="detail-stat"><span>Outcome</span><strong>${escapeHtml(session.outcome)}</strong></div>
          ${fields}
        </div>
        <div class="coach-readout">
          <p class="eyebrow">Coach Readout</p>
          <p>${escapeHtml(getSessionCoachReadout(session))}</p>
          <p>${escapeHtml(sessionScore.detail)}</p>
        </div>
        ${setSummary}
        ${golfPanel}
        ${gpsScorecard}
      </div>
      <aside class="session-detail-side">
        <p class="eyebrow">${template.sport} Lens</p>
        <h4>${profile.primaryMetric}: ${Math.round((getSportMinutes(template.sport) / 60) * 10) / 10}h</h4>
        <p>${profile.focus}</p>
        <div class="related-list">
          ${
            relatedSessions
              .map(
                (item) => `
            <button class="related-session" data-session-action="view" data-session-id="${item.id}" type="button">
              <strong>${escapeHtml(item.type)}</strong>
              <span>${formatDate(item.date)} - ${getSessionMinutes(item)} min</span>
            </button>
          `
              )
              .join("") || "<p>No related sessions yet.</p>"
          }
        </div>
      </aside>
    </div>
  `;
};

const renderGolfDashboardPanel = () => {
  const golf = getGolfAnalytics();
  return `
    <div class="golf-dashboard-panel">
      <div class="golf-stat-grid">
        <div><span>Avg score</span><strong>${formatStatValue(golf.averageScore)}</strong></div>
        <div><span>Avg putts</span><strong>${formatStatValue(golf.averagePutts)}</strong></div>
        <div><span>Range quality</span><strong>${formatStatValue(golf.averageRangeQuality, "/10")}</strong></div>
        <div><span>Short game</span><strong>${formatStatValue(golf.averageShortGame, "%")}</strong></div>
      </div>
      <div class="golf-mix-list">
        ${golf.practiceMix
          .map(
            (item) => `
          <div>
            <span>${escapeHtml(item.label)}</span>
            <strong>${item.value}</strong>
            <em style="--mix: ${Math.round((item.value / golf.totalPractice) * 100)}%"></em>
          </div>
        `
          )
          .join("")}
      </div>
      <p><strong>Primary miss:</strong> ${escapeHtml(golf.primaryMiss)}</p>
      <p>${escapeHtml(golf.focus)}</p>
    </div>
  `;
};

const renderSportDashboards = () => {
  const container = document.querySelector("#sportDashboardGrid");
  if (!container) return;

  container.innerHTML = getActiveSportProfiles()
    .map((profile) => {
      const sportSessions = getSessionsBySport(profile.sport);
      const minutes = getSportMinutes(profile.sport);
      const readiness = getSportReadiness(profile, sportSessions);
      const recoveryFlag = getSportRecovery(profile);
      const recent = sportSessions.slice(0, 2);
      const nextTemplates = profile.nextTypes
        .map((type) => getTemplate(type))
        .filter((template) => isProfileSportActive(template.sport));
      const golfPanel = profile.sport === "Golf" ? renderGolfDashboardPanel() : "";
      const sportRole = getProfileSportRole(profile.sport);

      return `
      <article class="sport-dashboard-card">
        <div class="sport-dashboard-head">
          <div>
            <p class="eyebrow">${profile.sport}</p>
            <h3>${profile.primaryMetric}</h3>
            <span class="profile-role-badge">${sportRole}</span>
          </div>
          <strong>${readiness}</strong>
        </div>
        <p>${profile.focus}</p>
        <div class="sport-stat-row">
          <div><span>Logged</span><strong>${sportSessions.length}</strong></div>
          <div><span>Volume</span><strong>${(minutes / 60).toFixed(1)}h</strong></div>
          <div><span>Watch</span><strong>${recoveryFlag.area} ${recoveryFlag.score}/10</strong></div>
        </div>
        <div class="sport-next-list">
          ${nextTemplates
            .map(
              (template) => `
            <button class="ghost-button" data-sport-template="${template.type}" type="button">${template.title}</button>
          `
            )
            .join("")}
        </div>
        ${golfPanel}
        <div class="related-list">
          ${
            recent
              .map(
                (session) => `
            <button class="related-session" data-session-action="view" data-session-id="${session.id}" type="button">
              <strong>${escapeHtml(session.type)}</strong>
              <span>${formatDate(session.date)} - ${getSessionMinutes(session)} min</span>
            </button>
          `
              )
              .join("") || "<p>No sessions logged yet.</p>"
          }
        </div>
      </article>
    `;
    })
    .join("");
};

const renderRecords = () => {
  const container = document.querySelector("#recordsGrid");
  if (!container) return;

  container.innerHTML = getPersonalRecords()
    .map(
      (record) => `
    <article class="record-card ${record.session ? "" : "empty"}">
      <span>${record.sport}</span>
      <strong>${record.value === null ? "--" : `${record.value}${record.unit}`}</strong>
      <h4>${record.title}</h4>
      <p>${record.session ? `${formatDate(record.session.date)} - ${escapeHtml(record.session.type)}` : "Log a matching session to set this mark."}</p>
      ${record.session ? `<button class="ghost-button" data-record-session="${record.session.id}" type="button">Open session</button>` : `<button class="ghost-button" data-record-template="${record.type}" type="button">Set record</button>`}
    </article>
  `
    )
    .join("");
};

const renderTrendCharts = () => {
  const container = document.querySelector("#trendChartGrid");
  if (!container) return;

  const analytics = getAnalytics();
  const sportFilter = document.querySelector("#progressSportFilter")?.value || "All sports";
  const chartSessions =
    sportFilter === "All sports"
      ? sessions
      : sessions.filter((session) => getTemplate(session.type).sport === sportFilter);
  const sportEntries = Object.entries(
    chartSessions.reduce((counts, session) => {
      const sport = getTemplate(session.type).sport;
      counts[sport] = (counts[sport] || 0) + 1;
      return counts;
    }, {})
  ).sort((a, b) => b[1] - a[1]);
  const recoveryItems = [...recovery].sort((a, b) => b.score - a.score).slice(0, 5);
  const weekBuckets = analytics.weekBuckets.map((week) => {
    if (sportFilter === "All sports") return week;
    const today = new Date();
    const weeksAgo = week.label === "This week" ? 0 : Number.parseInt(week.label, 10);
    const end = new Date(today);
    end.setDate(today.getDate() - weeksAgo * 7);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    const startKey = getDateKey(start);
    const endKey = getDateKey(end);
    const filtered = chartSessions.filter(
      (session) => session.date >= startKey && session.date <= endKey
    );
    return {
      ...week,
      minutes: filtered.reduce((sum, session) => sum + getSessionMinutes(session), 0),
      count: filtered.length,
    };
  });
  const averageScore = chartSessions.length
    ? Math.round(
        chartSessions.reduce((sum, session) => sum + getSessionScore(session).score, 0) /
          chartSessions.length
      )
    : 0;
  const weekMax = Math.max(60, ...weekBuckets.map((week) => week.minutes));

  container.innerHTML = `
    <article class="trend-card">
      <p class="eyebrow">${escapeHtml(sportFilter)} Load</p>
      <h4>Weekly minutes</h4>
      <div class="line-bars">
        ${weekBuckets
          .map(
            (week) => `
          <div>
            <span style="height: ${Math.max(10, (week.minutes / weekMax) * 100)}%"></span>
            <small>${week.label}</small>
          </div>
        `
          )
          .join("")}
      </div>
    </article>
    <article class="trend-card">
      <p class="eyebrow">Quality</p>
      <h4>Average score ${averageScore || "--"}</h4>
      <div class="stack-list">
        ${
          sportEntries
            .map(
              ([sport, count]) => `
          <div><strong>${sport}</strong><span><i style="width: ${Math.min(100, count * 24)}%"></i></span><small>${count}</small></div>
        `
            )
            .join("") || "<p>No sport data yet.</p>"
        }
      </div>
    </article>
    <article class="trend-card">
      <p class="eyebrow">Recovery Heat</p>
      <h4>Top soreness flags</h4>
      <div class="stack-list">
        ${recoveryItems
          .map(
            (item) => `
          <div><strong>${item.area}</strong><span><i style="width: ${item.score * 10}%"></i></span><small>${item.score}/10</small></div>
        `
          )
          .join("")}
      </div>
    </article>
  `;
};

const renderCalendar = () => {
  const grid = document.querySelector("#calendarGrid");
  if (!grid) return;

  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = firstDay.getDay();
  const todayKey = getToday();
  const calendarItems = getCalendarItems();

  document.querySelector("#calendarMonthLabel").textContent = getMonthLabel(calendarCursor);

  const cells = [];
  for (let index = 0; index < leadingBlanks; index += 1) {
    cells.push(`<div class="calendar-day empty" aria-hidden="true"></div>`);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const key = getDateKey(date);
    const dayItems = calendarItems.filter((item) => item.date === key);

    cells.push(`
      <article class="calendar-day ${key === todayKey ? "today" : ""}">
        <div class="calendar-day-head">
          <strong>${day}</strong>
          <span>${dayItems.length ? `${dayItems.length} item${dayItems.length === 1 ? "" : "s"}` : ""}</span>
        </div>
        <div class="calendar-items">
          ${dayItems
            .map(
              (item) => `
            <button class="calendar-item ${item.status}" data-calendar-${item.status}="${item.id}" type="button">
              <span>${item.sport}</span>
              <strong>${escapeHtml(item.title)}</strong>
              <small>${escapeHtml(item.meta)}</small>
            </button>
          `
            )
            .join("")}
        </div>
      </article>
    `);
  }

  grid.innerHTML = cells.join("");
};

const renderGolfGps = () => {
  const container = document.querySelector("#golfGpsView");
  if (!container) return;

  const hole = getActiveGpsHole();
  const score = getGpsHoleScore(hole.number);
  const adjustedYardage = getAdjustedYardage(hole);
  const club = getRecommendedClub(adjustedYardage);
  const totals = getGpsRoundTotals();
  const insights = getGpsRoundInsights();
  const toPar = totals.holes ? `${totals.toPar >= 0 ? "+" : ""}${totals.toPar}` : "E";
  const shotRows = score.shots || [];
  const roundAlreadySaved =
    gpsSavedSessionId && sessions.some((session) => session.id === gpsSavedSessionId);

  container.innerHTML = `
    <section class="gps-hero panel">
      <div>
        <p class="eyebrow">${escapeHtml(golfGpsCourse.name)}</p>
        <h2>Golf GPS Round Mode</h2>
        <p>Use this course-style mode for target yardages, hazards, shot notes, and a scorecard that can save back into your Golf Round log.</p>
      </div>
      <div class="gps-course-card">
        <span>Current tee</span>
        <strong>${escapeHtml(golfGpsCourse.tees[1].name)} tees</strong>
        <p>${golfGpsCourse.tees[1].yards} yds - ${golfGpsCourse.tees[1].rating}/${golfGpsCourse.tees[1].slope}</p>
        <button class="ghost-button inverse-button" data-gps-reset-round type="button">Reset round</button>
      </div>
    </section>

    <section class="gps-layout">
      <div class="gps-main panel">
        <div class="gps-hole-top">
          <div>
            <p class="eyebrow">Hole ${hole.number}</p>
            <h3>Par ${hole.par} - ${hole.yards} yards</h3>
          </div>
          <div class="gps-hole-nav">
            <button class="ghost-button" data-gps-hole-prev type="button">Previous</button>
            <button class="ghost-button" data-gps-hole-next type="button">Next</button>
          </div>
        </div>

        <div class="gps-yardage-grid">
          <div><span>Front</span><strong>${hole.front}</strong></div>
          <div class="primary"><span>Adjusted</span><strong>${adjustedYardage}</strong></div>
          <div><span>Back</span><strong>${hole.back}</strong></div>
          <div><span>Wind</span><strong>${escapeHtml(hole.wind)}</strong></div>
        </div>

        <div class="gps-map" aria-label="Simulated golf hole map">
          <div class="gps-tee">Tee</div>
          <div class="gps-fairway"></div>
          <div class="gps-green">Green</div>
          ${hole.hazards.map((hazard, index) => `<div class="gps-hazard hazard-${index + 1}">${escapeHtml(hazard.label)}</div>`).join("")}
          <div class="gps-target-line"></div>
        </div>

        <div class="gps-target-list">
          ${hole.hazards
            .map(
              (hazard) => `
            <article>
              <span>Hazard</span>
              <strong>${escapeHtml(hazard.label)}</strong>
              <p>${hazard.yards} yds to reach</p>
            </article>
          `
            )
            .join("")}
          ${hole.layups
            .filter(Boolean)
            .map(
              (layup) => `
            <article>
              <span>Layup</span>
              <strong>${layup} yds in</strong>
              <p>Conservative target window</p>
            </article>
          `
            )
            .join("")}
        </div>
      </div>

      <aside class="gps-side">
        <section class="panel club-recommendation">
          <p class="eyebrow">Club Recommendation</p>
          <h3>${escapeHtml(club.club)}</h3>
          <p>${club.carry} yd carry / ${club.total} yd total matched to ${adjustedYardage} adjusted yards.</p>
          <label>
            Manual wind
            <input id="gpsWindAdjustment" type="number" min="-40" max="40" value="${gpsWindAdjustment}" />
          </label>
          <label>
            Elevation
            <input id="gpsElevationAdjustment" type="number" min="-40" max="40" value="${gpsElevationAdjustment}" />
          </label>
          <label>
            Temperature
            <input id="gpsTemperature" type="number" min="30" max="115" value="${gpsTemperature}" />
          </label>
        </section>

        <section class="panel gps-score-form">
          <p class="eyebrow">Hole Log</p>
          <h3>Score and shot result</h3>
          <div class="gps-form-grid">
            <label>Strokes<input id="gpsStrokes" type="number" min="1" max="12" value="${escapeHtml(score.strokes || "")}" /></label>
            <label>Putts<input id="gpsPutts" type="number" min="0" max="6" value="${escapeHtml(score.putts || "")}" /></label>
            <label>Fairway<select id="gpsFairway">${["Hit", "Left", "Right", "Short", "Long", "N/A"].map((item) => `<option ${score.fairway === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>
            <label>GIR<select id="gpsGir">${["Yes", "No"].map((item) => `<option ${score.gir === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>
            <label>Penalty<input id="gpsPenalty" type="number" min="0" max="5" value="${escapeHtml(score.penalty || "0")}" /></label>
            <label>Lie<select id="gpsLie">${["Tee", "Fairway", "Rough", "Sand", "Recovery", "Green"].map((item) => `<option ${score.lie === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>
            <label>Club<select id="gpsClub">${golfClubBag.map((item) => `<option ${score.club === item.club || (!score.club && item.club === club.club) ? "selected" : ""}>${escapeHtml(item.club)}</option>`).join("")}</select></label>
            <label>Shot type<select id="gpsShotType">${["Stock", "Knockdown", "Flighted", "Speed swing", "Punch"].map((item) => `<option ${score.shotType === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>
            <label>Result<select id="gpsShotResult">${["Center", "Left", "Right", "Short", "Long", "Penalty", "Great"].map((item) => `<option ${score.shotResult === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>
          </div>
          <label>
            Hole strategy note
            <textarea id="gpsStrategyNote" rows="3" placeholder="Aim left center, avoid right bunker, miss short...">${escapeHtml(score.strategyNote || "")}</textarea>
          </label>
          <div class="gps-hole-actions">
            <button class="ghost-button" data-gps-add-shot type="button">Add shot</button>
            <button class="primary-button" data-gps-save-hole type="button">Save hole</button>
          </div>
          <div class="gps-shot-list">
            ${
              shotRows
                .map(
                  (shot) => `
              <article>
                <strong>${escapeHtml(shot.club)}</strong>
                <span>${escapeHtml(shot.lie)} - ${escapeHtml(shot.shotType)} - ${escapeHtml(shot.result)} - ${shot.distance} yds</span>
                <button class="ghost-button danger-button" data-gps-remove-shot="${shot.id}" type="button">Remove</button>
              </article>
            `
                )
                .join("") || "<p>No shots tracked for this hole yet.</p>"
            }
          </div>
        </section>

        <section class="panel gps-round-summary">
          <p class="eyebrow">Round Summary</p>
          <div class="gps-summary-grid">
            <div><span>Holes</span><strong>${totals.holes}</strong></div>
            <div><span>Score</span><strong>${totals.strokes || "--"}</strong></div>
            <div><span>To par</span><strong>${toPar}</strong></div>
            <div><span>Putts</span><strong>${totals.putts || "--"}</strong></div>
            <div><span>Fairways</span><strong>${totals.fairways}/${totals.fairwayHoles || 0}</strong></div>
            <div><span>GIR</span><strong>${totals.greens}</strong></div>
          </div>
          <div class="gps-recap">
            <p>${escapeHtml(insights.recap)}</p>
            <p>${escapeHtml(insights.practicePlan)}</p>
          </div>
          <div class="stack-list">
            ${insights.buckets
              .map(
                (bucket) => `
              <div><strong>${escapeHtml(bucket.label)}</strong><span><i style="width: ${Math.min(100, Math.round(bucket.value * 18))}%"></i></span><small>${bucket.value.toFixed(1)}</small></div>
            `
              )
              .join("")}
          </div>
          <button class="primary-button" data-gps-save-round type="button" ${roundAlreadySaved ? "disabled" : ""}>${roundAlreadySaved ? "Round saved" : "Save round to log"}</button>
        </section>
      </aside>
    </section>

    <section class="panel gps-scorecard-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Scorecard</p>
          <h3>Hole-by-hole view</h3>
        </div>
      </div>
      <div class="gps-scorecard">
        ${golfGpsCourse.holes
          .map((item) => {
            const itemScore = getGpsHoleScore(item.number);
            return `
            <button class="${item.number === activeGpsHole ? "active" : ""}" data-gps-hole="${item.number}" type="button">
              <span>${item.number}</span>
              <strong>${itemScore.strokes || "-"}</strong>
              <small>Par ${item.par}</small>
            </button>
          `;
          })
          .join("")}
      </div>
    </section>

    <section class="panel gps-club-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Club Bag</p>
          <h3>Edit carry and total distances</h3>
        </div>
        <button class="ghost-button" data-gps-save-clubs type="button">Save clubs</button>
      </div>
      <div class="gps-club-grid">
        ${golfClubBag
          .map(
            (item) => `
          <label data-club-row>
            <span data-club-name>${escapeHtml(item.club)}</span>
            <input data-club-carry type="number" min="0" max="400" value="${item.carry}" aria-label="${escapeHtml(item.club)} carry distance" />
            <input data-club-total type="number" min="0" max="430" value="${item.total}" aria-label="${escapeHtml(item.club)} total distance" />
          </label>
        `
          )
          .join("")}
      </div>
    </section>
  `;
};

const renderTemplates = () => {
  const builtInCards = sessionTemplates
    .map(
      (template, index) => `
    <button class="practice-card ${index === 0 ? "active" : ""}" data-session-preset="${template.type}" type="button">
      <span>${template.sport}</span>
      <strong>${template.title}</strong>
      <small>${template.description}</small>
    </button>
  `
    )
    .join("");
  const customCards = customDrills
    .map(
      (drill) => `
    <button class="practice-card custom-practice-card" data-custom-preset="${drill.id}" type="button">
      <span>${escapeHtml(drill.sport)} custom</span>
      <strong>${escapeHtml(drill.title)}</strong>
      <small>${escapeHtml(drill.detail)}</small>
    </button>
  `
    )
    .join("");

  document.querySelector("#templateGrid").innerHTML = builtInCards + customCards;

  document.querySelectorAll("[data-session-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      applyTemplate(button.dataset.sessionPreset);
      setView("log");
    });
  });

  document.querySelectorAll("[data-custom-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const drill = customDrills.find((item) => item.id === button.dataset.customPreset);
      if (!drill) return;
      applyTemplate(drill.type);
      document.querySelector("#notes").value = `${drill.title}: ${drill.detail} Cue: ${drill.cue}`;
      setView("log");
    });
  });
};

const renderSessionOptions = () => {
  document.querySelector("#sessionType").innerHTML = sessionTemplates
    .map(
      (template) => `
    <option>${template.type}</option>
  `
    )
    .join("");
};

const renderHistoryFilters = () => {
  const sports = ["All sports", ...new Set(sessionTemplates.map((template) => template.sport))];
  document.querySelector("#historyFilter").innerHTML = sports
    .map(
      (sport) => `
    <option>${sport}</option>
  `
    )
    .join("");
};

const renderProgressFilters = () => {
  const sports = ["All sports", ...new Set(sessionTemplates.map((template) => template.sport))];
  document.querySelector("#progressSportFilter").innerHTML = sports
    .map((sport) => `<option>${sport}</option>`)
    .join("");
};

const renderPlannerControls = () => {
  document.querySelector("#planDay").innerHTML = plannerDays
    .map((day) => `<option>${day}</option>`)
    .join("");
  const builtInOptions = sessionTemplates
    .map(
      (template) => `
    <option value="${template.type}">${template.type}</option>
  `
    )
    .join("");
  const customOptions = customDrills.length
    ? `
    <optgroup label="Custom templates">
      ${customDrills.map((drill) => `<option value="custom:${drill.id}">${escapeHtml(drill.title)} (${drill.sport})</option>`).join("")}
    </optgroup>
  `
    : "";
  document.querySelector("#planType").innerHTML = builtInOptions + customOptions;
  document.querySelector("#planDuration").value = getSelectedPlanTemplate().defaultDuration;
};

const renderProgramControls = () => {
  document.querySelector("#programFocus").innerHTML = programBlueprints
    .map(
      (program) => `
    <option value="${program.id}">${program.title}</option>
  `
    )
    .join("");
  document.querySelector("#programFocus").value = activeProgramId;
};

const renderProfileSelectOptions = (selector, options, selectedValue) => {
  const element = document.querySelector(selector);
  if (!element) return;
  element.innerHTML = options
    .map(
      (option) => `
    <option value="${escapeHtml(option)}" ${option === selectedValue ? "selected" : ""}>${escapeHtml(option)}</option>
  `
    )
    .join("");
};

const renderProfileSportGrid = () => {
  const container = document.querySelector("#profileSportGrid");
  if (!container) return;

  const activeSports = getProfileSports();
  container.innerHTML = sportProfiles
    .map((profile) => {
      const checked = activeSports.includes(profile.sport);
      const role = getProfileSportRole(profile.sport);
      const safeSport = escapeHtml(profile.sport);
      return `
      <article class="profile-sport-card ${checked ? "active" : ""}">
        <label class="profile-sport-toggle">
          <input data-profile-sport="${safeSport}" type="checkbox" ${checked ? "checked" : ""} />
          <span>${safeSport}</span>
        </label>
        <p>${escapeHtml(profile.focus)}</p>
        <label>
          Role
          <select data-profile-sport-role="${safeSport}">
            ${profileSportRoles.map((option) => `<option value="${option}" ${option === role ? "selected" : ""}>${option}</option>`).join("")}
          </select>
        </label>
      </article>
    `;
    })
    .join("");
};

const renderProfilePreview = () => {
  const container = document.querySelector("#profilePreview");
  if (!container) return;

  const summary = getProfileSummary();
  const recommendedTypes = getProfileRecommendedTypes().slice(0, 5);
  container.innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Personalization</p>
        <h3>How the app will adapt</h3>
      </div>
      <strong class="profile-completion">${summary.completion}%</strong>
    </div>
    <div class="profile-summary-grid">
      <article>
        <span>Identity</span>
        <strong>${escapeHtml(athleteProfile.name)}</strong>
        <p>${escapeHtml(athleteProfile.experienceLevel)} ${escapeHtml(athleteProfile.primarySport)} athlete</p>
      </article>
      <article>
        <span>Cadence</span>
        <strong>${escapeHtml(summary.cadence)}</strong>
        <p>${escapeHtml(athleteProfile.trainingDays)}</p>
      </article>
      <article>
        <span>Coach bias</span>
        <strong>${escapeHtml(summary.bias)}</strong>
        <p>${escapeHtml(summary.focusGoal.title)}</p>
      </article>
    </div>
    <div class="profile-pill-list">
      ${summary.activeSports
        .map(
          (profile) => `
        <span>${escapeHtml(profile.sport)}: ${escapeHtml(getProfileSportRole(profile.sport))}</span>
      `
        )
        .join("")}
    </div>
    <div class="profile-adapt-list">
      <p><strong>Sport rooms:</strong> ${escapeHtml(summary.sportNames.join(", "))}</p>
      <p><strong>Support mix:</strong> ${summary.supportSports.length ? escapeHtml(summary.supportSports.join(", ")) : "No support sports selected"}</p>
      <p><strong>Watch areas:</strong> ${escapeHtml(athleteProfile.watchAreas)}</p>
      <p><strong>Access:</strong> ${escapeHtml(athleteProfile.access)}</p>
    </div>
    <div class="sport-next-list">
      ${recommendedTypes
        .map((type) => {
          const template = getTemplate(type);
          return `<button class="ghost-button" data-profile-template="${template.type}" type="button">${template.title}</button>`;
        })
        .join("")}
    </div>
  `;
};

const renderProfile = () => {
  renderProfileSelectOptions("#profilePrimarySport", getKnownSports(), athleteProfile.primarySport);
  document.querySelector("#profileGoal").innerHTML = goals
    .map(
      (goal) => `
    <option value="${goal.id}">${goal.title}</option>
  `
    )
    .join("");
  renderProfileSelectOptions(
    "#profileTrainingStyle",
    profileTrainingStyles,
    athleteProfile.trainingStyle
  );
  renderProfileSelectOptions(
    "#profileSessionLength",
    profileSessionLengths,
    athleteProfile.preferredSessionLength
  );
  renderProfileSelectOptions(
    "#profileIntensity",
    profileIntensityOptions,
    athleteProfile.intensityPreference
  );
  renderProfileSelectOptions(
    "#profileExperience",
    profileExperienceLevels,
    athleteProfile.experienceLevel
  );
  document.querySelector("#profileName").value = athleteProfile.name;
  document.querySelector("#profilePrimarySport").value = athleteProfile.primarySport;
  document.querySelector("#profileGoal").value = athleteProfile.goalId;
  document.querySelector("#profileDays").value = athleteProfile.weeklyDays;
  document.querySelector("#profileTrainingDays").value = athleteProfile.trainingDays;
  document.querySelector("#profileTrainingStyle").value = athleteProfile.trainingStyle;
  document.querySelector("#profileSessionLength").value = athleteProfile.preferredSessionLength;
  document.querySelector("#profileIntensity").value = athleteProfile.intensityPreference;
  document.querySelector("#profileExperience").value = athleteProfile.experienceLevel;
  document.querySelector("#profileAccess").value = athleteProfile.access;
  document.querySelector("#profileOtherActivities").value = athleteProfile.otherActivities;
  document.querySelector("#profileWatchAreas").value = athleteProfile.watchAreas;
  document.querySelector("#profileNote").value = athleteProfile.note;
  renderProfileSportGrid();
  renderProfilePreview();
};

const renderPrograms = () => {
  document.querySelector("#programGrid").innerHTML = programs
    .map(
      (item) => `
    <article class="program-card">
      <div class="program-icon">${item.icon}</div>
      <h3>${item.title}</h3>
      <p>${item.detail}</p>
      <button class="ghost-button" data-program-jump="${item.tag}" type="button">${item.tag} plan</button>
    </article>
  `
    )
    .join("");
  renderProgramOutput();
};

const renderProgramOutput = () => {
  const container = document.querySelector("#programOutput");
  if (!container) return;

  const program = getProgramBlueprint();
  const volume = document.querySelector("#programVolume")?.value || "Balanced";
  container.innerHTML = `
    <div class="program-summary">
      <p class="eyebrow">${volume}</p>
      <h3>${program.title}</h3>
      <p>${program.focus}</p>
    </div>
    <div class="program-weeks">
      ${program.weeks
        .map(
          (week, index) => `
        <article class="program-week">
          <strong>Week ${index + 1}</strong>
          <div>
            ${week.map((type) => `<span>${getTemplate(type).title}</span>`).join("")}
          </div>
        </article>
      `
        )
        .join("")}
    </div>
  `;
};

const renderLibraryFilters = () => {
  const sports = ["All sports", ...new Set(getAllDrills().map((drill) => drill.sport))];
  document.querySelector("#libraryFilter").innerHTML = sports
    .map((sport) => `<option>${sport}</option>`)
    .join("");
};

const renderCustomDrillTypeOptions = () => {
  const sport = document.querySelector("#customDrillSport")?.value || "Golf";
  const matchingTemplates = sessionTemplates.filter((template) => template.sport === sport);
  document.querySelector("#customDrillType").innerHTML = matchingTemplates
    .map(
      (template) => `
    <option>${template.type}</option>
  `
    )
    .join("");
};

const renderDrillLibrary = () => {
  const filter = document.querySelector("#libraryFilter")?.value || "All sports";
  const search = (document.querySelector("#librarySearch")?.value || "").trim().toLowerCase();
  const drills = getAllDrills().filter((drill) => {
    const haystack = [drill.sport, drill.title, drill.detail, drill.cue, drill.type, ...drill.tags]
      .join(" ")
      .toLowerCase();
    return (
      (filter === "All sports" || drill.sport === filter) && (!search || haystack.includes(search))
    );
  });

  if (!drills.length) {
    document.querySelector("#drillGrid").innerHTML = `
      <article class="empty-state">
        <strong>No drills found</strong>
        <p>Try a different sport filter or search for a broader cue like speed, drops, serve, or power.</p>
      </article>
    `;
    return;
  }

  document.querySelector("#drillGrid").innerHTML = drills
    .map(
      (drill) => `
    <article class="drill-card ${drill.custom ? "custom" : ""}">
      <span>${escapeHtml(drill.sport)}${drill.custom ? " custom" : ""}</span>
      <h3>${escapeHtml(drill.title)}</h3>
      <p>${escapeHtml(drill.detail)}</p>
      <small>${escapeHtml(drill.cue)}</small>
      ${drill.custom ? `<small>Created ${formatDate(drill.createdAt)}</small>` : ""}
      <div class="drill-tags">${drill.tags.map((tag) => `<b>${escapeHtml(tag)}</b>`).join("")}</div>
      <div class="drill-actions">
        <button class="ghost-button" data-drill-template="${drill.type}" data-drill-id="${drill.id || ""}" type="button">Log this</button>
        ${drill.custom ? `<button class="ghost-button" data-drill-edit="${drill.id}" type="button">Edit</button>` : ""}
        ${drill.custom ? `<button class="ghost-button" data-drill-duplicate="${drill.id}" type="button">Duplicate</button>` : ""}
        ${drill.custom ? `<button class="ghost-button danger-button" data-drill-delete="${drill.id}" type="button">Delete</button>` : ""}
      </div>
    </article>
  `
    )
    .join("");
};

const renderCompareOptions = () => {
  const options = sessions
    .map(
      (session) =>
        `<option value="${session.id}">${escapeHtml(getSessionOptionLabel(session))}</option>`
    )
    .join("");
  document.querySelector("#compareA").innerHTML = options;
  document.querySelector("#compareB").innerHTML = options;
  if (sessions[0]) document.querySelector("#compareA").value = sessions[0].id;
  if (sessions[1]) document.querySelector("#compareB").value = sessions[1].id;
  renderCompare();
};

const renderCompare = () => {
  const container = document.querySelector("#compareGrid");
  if (!container) return;

  const first = sessions.find(
    (session) => session.id === document.querySelector("#compareA").value
  );
  const second = sessions.find(
    (session) => session.id === document.querySelector("#compareB").value
  );
  if (!first || !second) {
    container.innerHTML = `<article class="insight-item">Log at least two sessions to compare them.</article>`;
    return;
  }

  const sharedFields = [
    ...new Set([...Object.keys(first.values || {}), ...Object.keys(second.values || {})]),
  ];
  container.innerHTML = `
    ${[first, second]
      .map(
        (session) => `
      <article class="compare-card">
        <p class="eyebrow">${getTemplate(session.type).sport}</p>
        <h3>${escapeHtml(session.type)}</h3>
        <div class="detail-kpis">
          <div class="detail-stat"><span>Date</span><strong>${formatDate(session.date)}</strong></div>
          <div class="detail-stat"><span>Duration</span><strong>${getSessionMinutes(session)} min</strong></div>
          <div class="detail-stat"><span>Effort</span><strong>${getSessionEffort(session)}/10</strong></div>
          <div class="detail-stat"><span>Outcome</span><strong>${escapeHtml(session.outcome)}</strong></div>
        </div>
      </article>
    `
      )
      .join("")}
    <article class="compare-table wide">
      <div class="compare-row head"><strong>Metric</strong><strong>Session A</strong><strong>Session B</strong></div>
      <div class="compare-row"><span>Duration</span><span>${getSessionMinutes(first)} min</span><span>${getSessionMinutes(second)} min</span></div>
      <div class="compare-row"><span>Effort</span><span>${getSessionEffort(first)}/10</span><span>${getSessionEffort(second)}/10</span></div>
      ${sharedFields
        .map(
          (field) => `
        <div class="compare-row">
          <span>${escapeHtml(field)}</span>
          <span>${escapeHtml(first.values?.[field] || "-")}</span>
          <span>${escapeHtml(second.values?.[field] || "-")}</span>
        </div>
      `
        )
        .join("")}
    </article>
  `;
};

const renderPlanner = () => {
  document.querySelector("#plannerBoard").innerHTML = plannerDays
    .map((day) => {
      const dayPlans = plannedSessions.filter((plan) => plan.day === day);
      return `
      <section class="planner-day">
        <div class="planner-day-head">
          <strong>${day}</strong>
          <span>${dayPlans.length} planned</span>
        </div>
        <div class="planner-day-list">
          ${
            dayPlans
              .map((plan) => {
                const template = getPlanTemplate(plan);
                const title = getPlanTitle(plan);
                return `
              <article class="planned-session">
                <div>
                  <span>${template.sport}</span>
                  <strong>${escapeHtml(title)}</strong>
                  <p>${plan.durationMinutes} min - ${plan.priority}</p>
                </div>
                <div class="session-actions">
                  <button class="ghost-button" data-plan-action="complete" data-plan-id="${plan.id}" type="button">Complete</button>
                  <button class="ghost-button danger-button" data-plan-action="delete" data-plan-id="${plan.id}" type="button">Remove</button>
                </div>
              </article>
            `;
              })
              .join("") || `<p class="planner-empty">Open slot</p>`
          }
        </div>
      </section>
    `;
    })
    .join("");

  const sportCounts = plannedSessions.reduce((counts, plan) => {
    const sport = getPlanSport(plan);
    counts[sport] = (counts[sport] || 0) + 1;
    return counts;
  }, {});
  const totalMinutes = plannedSessions.reduce((sum, plan) => sum + plan.durationMinutes, 0);
  document.querySelector("#plannerSummary").innerHTML = `
    <div class="summary-tile"><strong>${(totalMinutes / 60).toFixed(1)}h</strong><span>Planned load</span></div>
    <div class="summary-tile"><strong>${plannedSessions.length}</strong><span>Total sessions</span></div>
    <div class="summary-tile"><strong>${Object.keys(sportCounts).length}</strong><span>Sport categories</span></div>
  `;
  document.querySelector("#plannerWarnings").innerHTML = getPlannerWarnings()
    .map(
      (warning) => `
    <article class="insight-item">${warning}</article>
  `
    )
    .join("");
  renderCalendar();
  renderDashboard();
  renderGoals();
};

const renderGoals = () => {
  const activeGoal = getGoal(activeGoalId);
  const activeProgress = getGoalProgress(activeGoal);

  document.querySelector("#goalGrid").innerHTML = goals
    .map((goal) => {
      const progress = getGoalProgress(goal);
      return `
      <button class="goal-card ${goal.id === activeGoalId ? "active" : ""}" data-goal-id="${goal.id}" type="button">
        <span>${goal.sport}</span>
        <strong>${goal.title}</strong>
        <p>${goal.target}</p>
        <div class="bar-track" aria-label="${goal.title} progress ${progress.progress} percent">
          <span style="width: ${progress.progress}%"></span>
        </div>
      </button>
    `;
    })
    .join("");

  document.querySelector("#goalDetail").innerHTML = `
    <div>
      <p class="eyebrow">Primary Goal</p>
      <h3>${activeGoal.title}</h3>
      <p>${activeGoal.copy}</p>
    </div>
    <div class="goal-score">
      <strong>${activeProgress.progress}%</strong>
      <span>${activeGoal.metric}</span>
    </div>
    <div class="planner-summary">
      <div class="summary-tile"><strong>${activeProgress.completedSessions}</strong><span>Logged sessions</span></div>
      <div class="summary-tile"><strong>${activeProgress.plannedSessions}</strong><span>Planned sessions</span></div>
      <div class="summary-tile"><strong>${Math.round((activeProgress.completedMinutes + activeProgress.plannedMinutes) / 60)}h</strong><span>Total focus</span></div>
    </div>
    <div>
      <p class="eyebrow">Best templates</p>
      <div class="goal-template-list">
        ${activeGoal.recommendedTypes.map((type) => `<button class="ghost-button" data-goal-template="${type}" type="button">${type}</button>`).join("")}
      </div>
    </div>
  `;

  document.querySelector("#sidebarGoalTitle").textContent = activeGoal.title;
  document.querySelector("#sidebarGoalMeter span").style.width = `${activeProgress.progress}%`;
  document
    .querySelector("#sidebarGoalMeter")
    .setAttribute("aria-label", `Goal completion ${activeProgress.progress} percent`);
  document.querySelector("#sidebarGoalText").textContent =
    `${activeProgress.progress}% toward ${activeGoal.target.toLowerCase()}.`;
};

const renderProgress = () => {
  const progress = getProgress();
  document.querySelector("#progressBars").innerHTML = progress
    .map(
      (item) => `
    <div class="progress-item">
      <strong>${item.label}</strong>
      <div class="bar-track" aria-label="${item.label} ${item.value} percent">
        <span style="width: ${item.value}%"></span>
      </div>
      <span>${item.value}%</span>
    </div>
  `
    )
    .join("");
  renderAnalytics();
  renderAdvancedAnalytics();
  renderRecords();
  renderTrendCharts();
};

const renderAnalytics = () => {
  const analytics = getAnalytics();
  const sportEntries = Object.entries(analytics.sportCounts).sort((a, b) => b[1] - a[1]);
  const goalRelatedCount = sessions.filter((session) =>
    analytics.goal.relatedSports.includes(getTemplate(session.type).sport)
  ).length;
  const trendCopy = [
    `${analytics.weekBuckets.at(-1).minutes} minutes logged this week across ${analytics.weekBuckets.at(-1).count} sessions.`,
    `${sportEntries[0]?.[0] || "Sport"} is carrying the current training mix.`,
    `${analytics.goal.title} has ${goalRelatedCount} related logged sessions and ${analytics.goalProgress.plannedSessions} planned focus sessions.`,
    `Average recovery flag is ${analytics.recoveryAverage.toFixed(1)}/10, with ${analytics.stats.highestFlag.area} currently the top limiter.`,
  ];

  document.querySelector("#analyticsGrid").innerHTML = `
    <article class="analytics-card">
      <p class="eyebrow">Weekly Load</p>
      <strong>${analytics.stats.totalHours.toFixed(1)}h</strong>
      <div class="mini-chart">
        ${analytics.weekBuckets
          .map(
            (week) => `
          <div class="chart-column">
            <span style="height: ${Math.max(8, (week.minutes / analytics.highestWeek) * 100)}%"></span>
            <small>${week.label}</small>
          </div>
        `
          )
          .join("")}
      </div>
    </article>
    <article class="analytics-card">
      <p class="eyebrow">Sport Mix</p>
      <strong>${Object.keys(analytics.sportCounts).length}</strong>
      <div class="mix-list">
        ${
          sportEntries
            .map(
              ([sport, count]) => `
          <div>
            <span>${sport}</span>
            <div class="bar-track"><span style="width: ${Math.min(100, count * 24)}%"></span></div>
            <small>${count}</small>
          </div>
        `
            )
            .join("") || "<p>No sessions yet</p>"
        }
      </div>
    </article>
    <article class="analytics-card">
      <p class="eyebrow">Goal Focus</p>
      <strong>${analytics.goalProgress.progress}%</strong>
      <div class="bar-track goal-focus-bar" aria-label="Goal focus ${analytics.goalProgress.progress} percent">
        <span style="width: ${analytics.goalProgress.progress}%"></span>
      </div>
      <p>${analytics.goal.metric}</p>
    </article>
    <article class="analytics-card">
      <p class="eyebrow">Recovery Risk</p>
      <strong>${analytics.recoveryAverage.toFixed(1)}</strong>
      <div class="bar-track recovery-risk-bar" aria-label="Recovery risk ${analytics.recoveryAverage.toFixed(1)} out of 10">
        <span style="width: ${analytics.recoveryAverage * 10}%"></span>
      </div>
      <p>${analytics.stats.highestFlag.area} leads at ${analytics.stats.highestFlag.score}/10</p>
    </article>
  `;

  document.querySelector("#trendReadout").innerHTML = trendCopy
    .map(
      (item) => `
    <article class="insight-item">${item}</article>
  `
    )
    .join("");
};

const renderAdvancedAnalytics = () => {
  const container = document.querySelector("#advancedAnalyticsGrid");
  if (!container) return;

  container.innerHTML = getAdvancedAnalytics()
    .map(
      (item) => `
    <article class="advanced-card">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
      <p>${escapeHtml(item.detail)}</p>
    </article>
  `
    )
    .join("");
};

const renderBodyMap = () => {
  document.querySelector("#bodyMap").innerHTML = recovery
    .map(
      (item) => `
    <article class="recovery-card ${item.score >= 7 ? "high" : ""}">
      <div class="recovery-card-head">
        <strong>${item.area}</strong>
        <span>${item.score}/10</span>
      </div>
      <label>
        Soreness
        <input data-recovery-score="${item.area}" type="range" min="1" max="10" value="${item.score}" />
      </label>
      <label>
        Trend
        <select data-recovery-trend="${item.area}">
          ${["Better", "Same", "Worse"].map((trend) => `<option ${trend === item.trend ? "selected" : ""}>${trend}</option>`).join("")}
        </select>
      </label>
    </article>
  `
    )
    .join("");

  document.querySelectorAll("[data-recovery-score]").forEach((input) => {
    input.addEventListener("input", () => {
      const area = input.dataset.recoveryScore;
      const score = Number(input.value);
      store.updateRecovery((list) =>
        list.map((part) => (part.area === area ? { ...part, score } : part))
      );
    });
  });

  document.querySelectorAll("[data-recovery-trend]").forEach((select) => {
    select.addEventListener("change", () => {
      const area = select.dataset.recoveryTrend;
      const trend = select.value;
      store.updateRecovery((list) =>
        list.map((part) => (part.area === area ? { ...part, trend } : part))
      );
    });
  });
};

const renderDashboard = () => {
  const stats = getTrainingStats();
  const flag = stats.highestFlag;
  const recommendation = getRecommendation(stats);
  const loadLabel =
    stats.totalHours >= 8
      ? "High training week, watch recovery"
      : "Workload is in a manageable range";
  const recoveryLevel = flag.score >= 7 ? "High" : flag.score >= 5 ? "Moderate" : "Low";

  document.querySelector("#readinessMetric").textContent = stats.readiness;
  document.querySelector("#readinessLabel").textContent =
    stats.readiness >= 75 ? "Green light with smart warmups" : "Dial intensity based on soreness";
  document.querySelector("#loadMetric").textContent = `${stats.totalHours.toFixed(1)}h`;
  document.querySelector("#loadLabel").textContent = loadLabel;
  document.querySelector("#mixMetric").textContent = stats.sportCount;
  document.querySelector("#mixLabel").textContent = stats.sportCount
    ? Object.entries(stats.sportCounts)
        .map(([sport, count]) => `${sport} ${count}`)
        .join(", ")
    : `Profile sports: ${getProfileSports().join(", ")}`;
  document.querySelector("#recoveryMetric").textContent = recoveryLevel;
  document.querySelector("#recoveryLabel").textContent =
    `${flag.area} is the top flag at ${flag.score}/10`;
  document.querySelector("#topbarReadiness").textContent = stats.readiness;
  document.querySelector("#topbarLoad").textContent = `${stats.totalHours.toFixed(1)}h`;
  document.querySelector("#topbarFocus").textContent = athleteProfile.primarySport;
  document.querySelector("#recommendationType").textContent = recommendation.type;
  document.querySelector("#recommendationTitle").textContent = recommendation.title;
  document.querySelector("#recommendationText").textContent = recommendation.text;

  renderReadinessCheckin(stats);
  renderTodayPanel(stats, recommendation);
  renderInsights(stats);
};

const renderTodayPanel = (
  stats = getTrainingStats(),
  recommendation = getRecommendation(stats)
) => {
  const container = document.querySelector("#todayGrid");
  if (!container) return;

  const checkin = getTodayCheckin();
  const planItems = getTodayPlanItems();
  const lastSession = sessions[0];
  const nextPlan = planItems[0];
  const planCopy = nextPlan
    ? `${getPlanTitle(nextPlan)} - ${nextPlan.durationMinutes} min - ${nextPlan.priority}`
    : "No planned session loaded yet";
  const lastCopy = lastSession
    ? `${lastSession.type} scored ${getSessionScore(lastSession).score} on ${formatDate(lastSession.date)}`
    : "No sessions logged yet";

  container.innerHTML = `
    <article class="today-card">
      <span>Readiness</span>
      <strong>${stats.readiness}</strong>
      <p>${checkin ? `Checked in: sleep ${checkin.sleep}/10, energy ${checkin.energy}/10.` : "Save a check-in to tune today's recommendation."}</p>
    </article>
    <article class="today-card">
      <span>Planned</span>
      <strong>${nextPlan ? getPlanSport(nextPlan) : "Open"}</strong>
      <p>${escapeHtml(planCopy)}</p>
      ${nextPlan ? `<button class="ghost-button" data-today-complete="${nextPlan.id}" type="button">Complete</button>` : `<button class="ghost-button" data-view-jump="planner" type="button">Build plan</button>`}
    </article>
    <article class="today-card">
      <span>Recommended</span>
      <strong>${escapeHtml(recommendation.type)}</strong>
      <p>${escapeHtml(recommendation.title)}</p>
      <button class="ghost-button" data-view-jump="log" type="button">Start</button>
    </article>
    <article class="today-card">
      <span>Last logged</span>
      <strong>${lastSession ? getTemplate(lastSession.type).sport : "None"}</strong>
      <p>${escapeHtml(lastCopy)}</p>
      ${lastSession ? `<button class="ghost-button" data-today-open="${lastSession.id}" type="button">Open</button>` : `<button class="ghost-button" data-view-jump="log" type="button">Log first</button>`}
    </article>
  `;
};

const renderReadinessCheckin = (stats = getTrainingStats()) => {
  const checkin = getTodayCheckin();
  const score = getReadinessScoreFromCheckin(checkin);
  const defaults = checkin || {
    sleep: 7,
    soreness: 3,
    energy: 7,
    stress: 3,
    motivation: 8,
    note: "",
  };
  document.querySelector("#checkinSleep").value = defaults.sleep;
  document.querySelector("#checkinSoreness").value = defaults.soreness;
  document.querySelector("#checkinEnergy").value = defaults.energy;
  document.querySelector("#checkinStress").value = defaults.stress;
  document.querySelector("#checkinMotivation").value = defaults.motivation;
  document.querySelector("#checkinNote").value = defaults.note || "";
  document.querySelector("#checkinStatus").textContent = checkin
    ? `Saved ${formatDate(checkin.date)}`
    : "Not checked in";
  document.querySelector("#readinessScore").textContent =
    score === null ? `Ready: ${stats.readiness}` : `Check-in ready: ${score}`;
};

const renderInsights = (stats) => {
  const flag = stats.highestFlag;
  const goal = getGoal(activeGoalId);
  const goalProgress = getGoalProgress(goal);
  const sortedSports = Object.entries(stats.sportCounts).sort((a, b) => b[1] - a[1]);
  const topSport = sortedSports[0]?.[0] || "Sport";
  const profileSummary = getProfileSummary();
  const insights = [
    `${goal.title} is the active goal at ${goalProgress.progress}% with ${goalProgress.plannedSessions} planned focus sessions.`,
    `Profile bias: ${profileSummary.bias} across ${profileSummary.sportNames.join(", ")}.`,
    `${topSport} is your dominant category right now with ${sortedSports[0]?.[1] || 0} logged sessions.`,
    `${stats.totalHours.toFixed(1)} total hours are logged across ${sessions.length} sessions.`,
    `${flag.area} is the main recovery limiter at ${flag.score}/10 and trending ${flag.trend.toLowerCase()}.`,
  ];

  if ((stats.sportCounts.Tennis || 0) > 0 && flag.area === "Shoulder" && flag.score >= 5) {
    insights.push(
      "Shoulder load is worth watching because tennis sessions and pressing volume can stack quickly."
    );
  }

  if ((stats.sportCounts.Golf || 0) > 0) {
    const golf = getGolfAnalytics();
    insights.push(
      `Golf signal: ${golf.focus} Recent scoring averages ${formatStatValue(golf.averageScore)} with ${formatStatValue(golf.averagePutts)} putts.`
    );
  }

  if ((stats.sportCounts.Pickleball || 0) > 0 && ["Knees", "Ankles"].includes(flag.area)) {
    insights.push(
      "Court volume plus lower-leg soreness suggests adding calf, ankle, and quad durability before more hard matches."
    );
  }

  if (!stats.sportCounts.Endurance) {
    insights.push(
      "Add one easy aerobic session to support recovery and late-round or late-match stamina."
    );
  }

  const checkin = getTodayCheckin();
  if (checkin) {
    insights.push(
      `Today's check-in: sleep ${checkin.sleep}/10, soreness ${checkin.soreness}/10, energy ${checkin.energy}/10${checkin.note ? `. Note: ${checkin.note}` : "."}`
    );
  }

  document.querySelector("#insightList").innerHTML = insights
    .map(
      (insight) => `
    <article class="insight-item">${insight}</article>
  `
    )
    .join("");
};

const renderSportFields = (currentValues = {}) => {
  const sessionType = document.querySelector("#sessionType").value;
  const fields = getTemplate(sessionType).fields;
  const sportFields = document.querySelector("#sportFields");

  sportFields.innerHTML = fields
    .map((field) => {
      if (field.type === "select") {
        return `
        <label>
          ${field.label}
          <select id="${field.id}">
            ${field.options.map((option) => `<option ${String(currentValues[field.id] || field.value || field.options[0]) === option ? "selected" : ""}>${option}</option>`).join("")}
          </select>
        </label>
      `;
      }

      return `
      <label>
        ${field.label}
        <input id="${field.id}" type="${field.type}" min="1" max="${field.type === "range" ? "10" : "500"}" value="${currentValues[field.id] || field.value}" />
      </label>
    `;
    })
    .join("");

  sportFields.classList.toggle("empty", fields.length === 0);
};

const renderLiftSets = (sets = []) => {
  const isLifting = document.querySelector("#sessionType").value === "Lifting";
  const builder = document.querySelector("#liftSetBuilder");
  const list = document.querySelector("#liftSetList");
  builder.hidden = !isLifting;
  if (!isLifting) {
    list.innerHTML = "";
    return;
  }

  const liftSets = sets.length ? sets : getDefaultLiftSets();
  list.innerHTML = liftSets
    .map(
      (set, index) => `
    <div class="lift-set-row" data-lift-row>
      <input data-lift-field="exercise" type="text" value="${escapeHtml(set.exercise || "Exercise")}" aria-label="Exercise" />
      <input data-lift-field="set" type="number" min="1" value="${set.set || index + 1}" aria-label="Set number" />
      <input data-lift-field="reps" type="number" min="1" value="${set.reps || 5}" aria-label="Reps" />
      <input data-lift-field="weight" type="number" min="0" value="${set.weight || 0}" aria-label="Weight" />
      <input data-lift-field="rpe" type="number" min="1" max="10" value="${set.rpe || 7}" aria-label="RPE" />
      <button class="ghost-button danger-button" data-lift-remove type="button">Remove</button>
    </div>
  `
    )
    .join("");
};

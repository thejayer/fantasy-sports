const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const read = (file) => fs.readFileSync(path.join(publicDir, file), "utf8");
const exists = (file) => fs.existsSync(path.join(publicDir, file));

const requiredFiles = [
  "app.html",
  "styles.css",
  "sj-chrome.js",
  "utils.js",
  "data.js",
  "store.js",
  "timers.js",
  "analytics.js",
  "render.js",
  "events.js",
  "app.js",
  "service-worker.js",
  "manifest.webmanifest",
  "assets/app-icon.svg",
  "assets/court-course.svg",
  "fonts/Archivo-latin-400.woff2",
];

const requiredScripts = [
  "sj-chrome.js",
  "utils.js",
  "data.js",
  "store.js",
  "timers.js",
  "analytics.js",
  "render.js",
  "events.js",
  "app.js",
];

const errors = [];

for (const file of requiredFiles) {
  if (!exists(file)) errors.push(`Missing required file: ${file}`);
}

const indexHtml = exists("app.html") ? read("app.html") : "";
let previousIndex = -1;
for (const script of requiredScripts) {
  const marker = `<script src="${script}"></script>`;
  const markerIndex = indexHtml.indexOf(marker);
  if (markerIndex === -1) {
    errors.push(`app.html does not load ${script}`);
  } else if (markerIndex < previousIndex) {
    errors.push(`app.html loads ${script} out of order`);
  }
  previousIndex = markerIndex;
}

if (!indexHtml.includes("Strictly Jayers")) {
  errors.push("app.html should use Strictly Jayers chrome");
}
if (!indexHtml.includes('class="page-hero"')) {
  errors.push("app.html should use the SJ page-hero, not athlete-log brand chrome");
}
if (indexHtml.includes("Athlete Log")) {
  errors.push("app.html still brands as Athlete Log");
}
if (indexHtml.includes("#cc0000")) {
  errors.push("app.html still uses the Texas Tech red token");
}

const styles = exists("styles.css") ? read("styles.css") : "";
if (styles.includes("#cc0000")) {
  errors.push("styles.css still uses the Texas Tech red token");
}
if (!styles.includes("--color-accent") || !styles.includes("Archivo")) {
  errors.push("styles.css should use Modernist tokens and Archivo");
}

const manifest = exists("manifest.webmanifest") ? JSON.parse(read("manifest.webmanifest")) : {};
if (manifest.name !== "Strictly Jayers Fitness") {
  errors.push("manifest.webmanifest name should be Strictly Jayers Fitness");
}
if (manifest.theme_color !== "#ec3013") {
  errors.push("manifest.webmanifest theme_color should be Signal Red");
}
if (!Array.isArray(manifest.icons) || !manifest.icons.length) {
  errors.push("manifest.webmanifest must define icons");
}

const serviceWorker = exists("service-worker.js") ? read("service-worker.js") : "";
for (const file of requiredFiles.filter((file) => file !== "service-worker.js")) {
  const cachePath = `./${file}`;
  if (!serviceWorker.includes(cachePath)) {
    errors.push(`service-worker.js does not cache ${cachePath}`);
  }
}
if (!serviceWorker.includes("/api/") || !serviceWorker.includes("/_next/")) {
  errors.push("service-worker.js must bypass /api/ and /_next/");
}

const appSource = requiredScripts.map((file) => read(file)).join("\n");
for (const symbol of [
  "renderGolfGps",
  "saveGpsRoundToLog",
  "normalizeGolfClubBag",
  "parseCsvRow",
]) {
  if (!appSource.includes(symbol)) errors.push(`Expected app symbol missing: ${symbol}`);
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log("Fitness app verification passed.");

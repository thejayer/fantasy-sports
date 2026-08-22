// @ts-nocheck -- ServiceWorkerGlobalScope is a separate lib from DOM.
const cacheName = "sj-fitness-v4";
const appShell = [
  "./",
  "./app.html",
  "./styles.css",
  "./sj-chrome.js",
  "./utils.js",
  "./data.js",
  "./store.js",
  "./timers.js",
  "./analytics.js",
  "./render.js",
  "./events.js",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/court-course.svg",
  "./assets/app-icon.svg",
  "./fonts/Archivo-latin-400.woff2",
  "./fonts/Archivo-latin-600.woff2",
  "./fonts/Archivo-latin-800.woff2",
];

function shouldBypass(request) {
  if (request.method !== "GET") return true;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return true;
  return url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/");
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(appShell)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (shouldBypass(event.request)) return;
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          const copy = response.clone();
          caches.open(cacheName).then((cache) => cache.put(event.request, copy));
          return response;
        }),
    ),
  );
});

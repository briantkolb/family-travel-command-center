const CACHE_PREFIX = "travel-command-center-reference-";
const CACHE = `${CACHE_PREFIX}shell-v4`;
const SHELL = [
  "/",
  "/manifest.webmanifest?v=2",
  "/favicon.svg",
  "/favicon-32.png",
  "/icon-192.png",
  "/icon-512.png",
  "/maskable-icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;

  const isNavigation = request.mode === "navigate";
  const isShareSafe = url.searchParams.get("share") === "1";
  const isBuildAsset = url.pathname.startsWith("/assets/");
  const isShellAsset = SHELL.includes(`${url.pathname}${url.search}`) || SHELL.includes(url.pathname);
  if (!isNavigation && !isBuildAsset && !isShellAsset) return;

  if (isBuildAsset || (!isNavigation && isShellAsset)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) =>
          cached || (isShareSafe ? Response.error() : caches.match("/")),
        ),
      ),
  );
});

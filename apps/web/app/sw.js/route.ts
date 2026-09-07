const staleServiceWorkerCleanup = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.registration.unregister());
});
`;

function response() {
  return new Response(staleServiceWorkerCleanup, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
    },
  });
}

/**
 * This application does not install a service worker. Local browsers can keep
 * a registration from an older app on localhost:3000 and repeatedly request
 * /sw.js. Serving a one-time cleanup worker removes that stale registration.
 */
export function GET() {
  return response();
}

export function HEAD() {
  return response();
}

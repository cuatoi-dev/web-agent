// 124/003 — answers the page's fetch('/api/totals') with its own response, so
// page_network shows a page request a service worker answered.
self.addEventListener("install", () => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname === "/api/totals") {
    event.respondWith(
      new Response(JSON.stringify({ from: "service-worker" }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
    );
  }
});

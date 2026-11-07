// Minimaler Service Worker: macht die Seite installierbar. Es wird nichts zwischengespeichert,
// damit am Desktop immer der aktuelle Stand erscheint.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

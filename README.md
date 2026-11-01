# Spur (von Wladi)

Zeiterfassung für eine kleine Handwerksfirma: Android-App mit GPS, Server und Desktop-Oberfläche im Browser.

- `server/` – Server (Node.js 22, SQLite) mit Anmeldung per Zugangscode, Tagen und GPS-Punkten
- `desktop/` – Desktop-Oberfläche im Browser (wird vom Server ausgeliefert)
- `android/` – Handy-App (Kotlin, Jetpack Compose)
- `e2e/` – Browser-Tests mit Playwright

Server testen: `cd server && npm install && npm test`

#!/bin/bash
# Holt neue Versionen von GitHub, startet den Server neu und geht bei einem Fehler zur letzten
# funktionierenden Version zurück. Wird alle paar Minuten vom Systemzeitgeber gestartet.
set -u
DIR="${SPUR_DIR:-/opt/spur}"
BRANCH="${SPUR_BRANCH:-main}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
HEALTH_URL="${SPUR_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
LOG="${SPUR_UPDATE_LOG:-/var/log/spur-update.log}"

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

cd "$DIR" || exit 1
git fetch --quiet origin "$BRANCH" || { log "Abruf fehlgeschlagen (kein Internet?)"; exit 0; }

OLD=$(git rev-parse HEAD)
NEW=$(git rev-parse "origin/$BRANCH")
[ "$OLD" = "$NEW" ] && exit 0
[ -f "$DIR/.bad-version" ] && [ "$(cat "$DIR/.bad-version")" = "$NEW" ] && exit 0
rm -f "$DIR/.bad-version"

install_and_restart() {
  (cd server && npm install --omit=dev --no-audit --no-fund >> "$LOG" 2>&1) || return 1
  "$SYSTEMCTL" restart spur || return 1
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 2
    curl -fsS "$HEALTH_URL" > /dev/null 2>&1 && return 0
  done
  return 1
}

log "Neue Version ${NEW:0:7} (bisher ${OLD:0:7})"
git reset --hard "origin/$BRANCH" > /dev/null
if install_and_restart; then
  log "Aktualisiert auf ${NEW:0:7}"
else
  log "FEHLER mit ${NEW:0:7}, gehe zurück auf ${OLD:0:7}"
  git reset --hard "$OLD" > /dev/null
  install_and_restart && log "Zurückgesetzt auf ${OLD:0:7}" || log "Rückfall fehlgeschlagen"
  # Diese fehlerhafte Version nicht ständig neu versuchen:
  echo "$NEW" > "$DIR/.bad-version"
fi

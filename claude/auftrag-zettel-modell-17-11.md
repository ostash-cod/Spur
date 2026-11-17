# Auftrag: Zettel-Modell – drei gleichwertige Wege, Entwurf nur auf dem Handy, keine stillen Originale, Runden auf 5 Minuten

Stand: 17.11.2026. Von Wladi in einem langen Gespräch festgelegt. Gehört zu `auftrag-version-08-c-variante.md`, `datenschutz-und-gps-entscheidung-13-11.md`, `bauplan-spur.md`, `stand-und-aenderungen.md` und `auftrag-desktop-wochenansicht-kundenmaske.md`.

**Dieses Dokument ersetzt, wo es widerspricht:**
- `auftrag-version-08-c-variante.md`, Schritt 3: Absatz „Originale im Hintergrund" und Abnahme-Punkt 8 (Original-Vorschlag in der Datenbank). **Nicht bauen.**
- `datenschutz-und-gps-entscheidung-13-11.md`, Abschnitt 3a: „Originale im Hintergrund". **Nicht bauen.**
- Auftrag Desktop (`auftrag-desktop-wochenansicht-kundenmaske.md`), Abschnitt 3: „Originale im Hintergrund" beim Bearbeiten. **Nicht bauen.**
- Alles andere in diesen Dokumenten gilt weiter.

Wladi spricht Deutsch nicht perfekt: kurze Sätze, keine Fachwörter ohne Erklärung. Fragen sammeln und in einer Nachricht stellen. Wladi bittet ausdrücklich: Wenn dir etwas widerspricht oder riskant vorkommt, sag es ihm direkt.

## 1. Grundsatz (Wladi)
Spur ist ein **elektronischer Zettel, den der Mitarbeiter selbst ausfüllt**. Es ist keine Überwachung. GPS ist nur eine Ausfüllhilfe, wie ein Kugelschreiber auf Papier. Der Chef sieht nur den abgegebenen Zettel. Der Mitarbeiter darf alles auf seinem Zettel ändern, bevor er abgibt, und der Chef merkt es nicht. Das ist Vertrauenssache.

## 2. Drei gleichwertige Wege, ein Zettel
Der Mitarbeiter wählt selbst, pro Tag, ohne Nachteil. Der Chef sieht **nicht**, welchen Weg er genommen hat. Der abgegebene Zettel sieht immer gleich aus.
1. **Tabelle von Hand:** Zeilen mit Abfahrt, Ankunft Baustelle (Baustelle aus der Kontaktliste wählen), Abfahrt Baustelle, Ankunft Firma, Pause, Feierabend. Zeiten von Hand eingeben.
2. **Stoppuhr:** Baustelle antippen (wie eine Stempeluhr), Ende antippen.
3. **GPS-Hilfe:** Die App schlägt Orte und Zeiten vor (wie bisher in Version 0.7/0.8).

Alle drei Wege landen in **derselben Tabelle** („Mein Tag"). Dort prüft und ändert der Mitarbeiter alles.

**Zuerst prüfen und Wladi melden:** Kann ein Mitarbeiter die App **ohne GPS-Aufzeichnung** nutzen (nur Weg 1 und 2)? Wenn nicht, zuerst einen Schalter „GPS-Hilfe aus" bauen (pro Mitarbeiter, am Handy selbst einstellbar, nicht vom Chef). Wladi will Mykhaylo und Serhii **sofort ohne GPS** testen lassen. Clockodo läuft zum Vergleich weiter.

## 3. Entwurf nur auf dem Handy bis zur Abgabe
- Alles, was während des Tages entsteht (Abschnitte, Vorschläge, Rohpunkte, Änderungen), **bleibt auf dem Handy**.
- **Prüfe**, ob die App heute schon laufend Abschnitte zum Server schickt („Abgleich"). Wenn ja: umstellen. Der Server bekommt erst etwas, wenn der Mitarbeiter **„Tag abgeben"** drückt. Der Chef sieht vorher nichts.
- Ein Ausnahme-Schalter nur für Wladis eigenes Handy (Test, Karte „Gefahrener Weg") darf bleiben, Standard aus.
- „Tag abgeben": Der Mitarbeiter sieht die Tabelle, prüft, ändert, bestätigt. Danach geht **nur der fertige Zettel** zum Server: Datum, Beginn, Ende, Pause, Baustellen mit Zeiten, Fahrtart, Kilometer, Beschreibung. Keine Punkte, keine Spur, kein Vorschlag.
- Am Desktop kommt der Zettel bei Wladi an und darf von ihm weiter bearbeitet werden (siehe 6).

## 4. GPS-Rohpunkte löschen
- Das Handy löscht die Rohpunkte des Tages **sofort bei „Tag abgeben"**.
- Gibt der Mitarbeiter nicht ab: spätestens **48 Stunden nach „Tag beenden"** löschen. Der Mitarbeiter wird vorher erinnert.
- Zeiten und Abschnitte bleiben (mindestens 2 Jahre, nach der Abgabe).
- Ersetzt „24 bis 48 Stunden" aus der Version-0.8-Datei. Der Handyspeicher ist kein Problem: Ein Tag Punkte ist nur einige hundert Kilobyte.
- **Bestehende Daten auf dem Server** (alte GPS-Punkte): nicht still löschen. Datenbank sichern, dann Wladi fragen.

## 5. Runden auf 5 Minuten
- Alle Zeiten auf dem Zettel (Beginn, Ende, Wechsel zwischen Baustellen, Fahrten, Pausen) werden beim Abgeben auf die **nächste volle 5 Minuten** gerundet (kaufmännisch: 17:38 wird 17:40, 17:37 wird 17:35). So kann man nicht erkennen, ob eine Zeit von Hand oder vom GPS kam.
- **Nicht immer nach unten runden.** Wladi hatte „abrunden" gesagt. Das würde den Mitarbeitern bis zu 4 Minuten Lohn pro Eintrag nehmen. Wladi hat diesem Punkt zugestimmt, als wir es besprachen. Steuerberater bestätigt später.
- Dasselbe gilt für Zeiten, die der Mitarbeiter von Hand eintippt.
- Das „Aufrunden 5/10/15" im Kundenbericht ist eine eigene Einstellung und bleibt wie in `auftrag-kundenbericht.md`.

## 6. Keine stillen Originale, kein Änderungsverlauf
- **Nicht speichern:** den Vorschlag der GPS-Hilfe, den Stand vor der Änderung, einen Änderungsverlauf.
- Gespeichert wird nur der **abgegebene Zettel** mit dem echten Abgabedatum.
- Ändert Wladi am Desktop einen Zettel, bestätigt der Mitarbeiter die geänderte Fassung (wie im Bauplan). Vorherige Fassungen werden **nicht** aufbewahrt. Wenn dir dazu etwas unklar ist, frag Wladi.
- Der **Betriebsschalter „Änderungen anzeigen/protokollieren"** bleibt als Möglichkeit für andere Firmen vorgesehen, **Standard aus**. Nicht jetzt ausbauen.
- **Offen (Anwalt):** Wladi will beim Landesamt (BayLDA) und beim Anwalt fragen, ob der abgegebene Zettel ohne Änderungsverlauf reicht (Herr Nolte schrieb, Änderungen müssten nachvollziehbar bleiben). Bau die Funktion so, dass sich ein Protokoll später einschalten lässt.

## 7. Woche
- Der Mitarbeiter gibt jeden Tag ab, spätestens am Ende der Woche. Erinnerung wie in den bisherigen Dokumenten festgelegt (Wladi nennt Montag, wenn noch offen).
- Am Ende der Woche: Wochenzettel als PDF. Wladi prüft und schickt ihn zurück an den Mitarbeiter. Der Mitarbeiter bestätigt am Handy: „Ich habe die Datei geprüft und bin einverstanden." Das gilt als bestätigt. Die Bestätigung hat das **echte** Datum.
- Danach ist der Wochenzettel **gesperrt** (Regel der App, keine Rechtsaussage in den Zettel schreiben). Der Wochenzettel wird archiviert (mindestens 2 Jahre).
- Das PDF zeigt nur die endgültigen Werte und den Satz, dass der Zettel vom Mitarbeiter geprüft und bestätigt wurde. Keine „korrigiert"-Vermerke.

## 8. Was gleich bleibt
Pausenregel, Fahrten, Kilometergeld, Fahrtarten, Arbeitsfenster mit „Arbeitest du noch?", automatische Abschaltung (17 Uhr, 3 Nachfragen, 22 Uhr), unbekannter Ort nach 10 Minuten, Kundenbericht-Tabelle, keine Wohnadressen speichern, keine Strecke auf dem Server im Normalbetrieb.

## 9. Reihenfolge
1. Prüfen und melden: Gibt es GPS-Aus? Schickt die App heute schon Daten vor der Abgabe zum Server? Was zeigt der Desktop an Punkten?
2. Schalter „GPS-Hilfe aus" (falls nötig), damit der Test ohne GPS sofort starten kann.
3. Entwurf nur auf dem Handy, „Tag abgeben" mit Tabelle, Weg 1 und 2.
4. Rohpunkte löschen bei Abgabe (und nach 48 Stunden).
5. Runden auf 5 Minuten beim Abgeben.
6. Wochenzettel mit Bestätigung.
7. Altdaten auf dem Server: Wladi fragen.
Nach jedem Schritt testet Wladi. Server-Snapshot bei Hetzner vor Änderungen am Datenmodell.

## 10. Abnahme
1. Ohne GPS-Hilfe kann ein Mitarbeiter einen kompletten Tag eintragen und abgeben.
2. Vor „Tag abgeben" liegt auf dem Server nichts vom Tag, und der Chef sieht nichts.
3. Nach „Tag abgeben": Zettel am Desktop, ohne Punkte und ohne Hinweis auf den Weg.
4. Rohpunkte auf dem Handy sind nach der Abgabe weg.
5. Alle Zeiten sind auf 5 Minuten gerundet (nächste volle, nicht nur abgerundet).
6. In der Datenbank gibt es keinen Vorschlag und keinen Änderungsverlauf.
7. Wochenzettel mit Bestätigung und echtem Datum wird archiviert.
8. Die Selbst-Aktualisierung der App (APK) geht weiter.

## 11. Zuerst fragen, wenn unklar
- Heute schon Abgleich zum Server vor der Abgabe: Wie ändert sich dadurch die Tagesansicht von Wladi am Desktop (nur abgegebene Tage)?
- Wochenbestätigung: Schickt Wladi den Wochenzettel aus Spur oder per anderem Weg an den Mitarbeiter?
- Was passiert, wenn ein Mitarbeiter nicht abgibt (nach 48 Stunden Punkte weg, Tag bleibt leer)?

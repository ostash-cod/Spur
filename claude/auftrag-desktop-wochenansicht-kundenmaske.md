# Auftrag: Desktop – Wochenansicht, Mitarbeiter-Wechsel, Bearbeiten, Kundenmaske, Vorschau-Fehler

Stand: 17.11.2026. Von Wladi besprochen, Bau darf nach Rückfrage beginnen. Gehört zu `bauplan-spur.md`, `stand-und-aenderungen.md`, `auftrag-kundenbericht.md` und `auftrag-version-08-c-variante.md`. **Bei Widerspruch gelten `datenschutz-und-gps-entscheidung-13-11.md` und `auftrag-version-08-c-variante.md`** (Rohpunkte nur auf dem Handy, Abgabe-Modell).

Wladi spricht Deutsch nicht perfekt: kurze Sätze, keine Fachwörter ohne Erklärung. Fragen sammeln und in einer Nachricht stellen.

Vorbild: Wladi schickt Bilder von Clockodo (Stundenkonto-Übersicht, Monatsansicht, Wochenansicht, Zeiteintrag bearbeiten, Mitarbeiter-Wechsel) und von LexOffice (Fenster „Neuer Kontakt“). Nur Aussehen und Ablauf übernehmen, nicht die Funktionen, die Wladi streicht.

## 1. Fehler zuerst: Vorschau im Bericht
- Die Vorschau am Desktop (Seite „Berichte“) lässt sich nicht schließen. Es gibt kein Kreuz und keinen Zurück-Knopf. Wladi muss „Vorschau“ erneut drücken, um Haken (zum Beispiel Notiz) zu ändern.
- Gewünscht: Knopf „Vorschau schließen“ (Kreuz oben rechts), danach sind die Haken wieder frei. Die Vorschau aktualisiert sich bei jeder Änderung eines Hakens von selbst.
- Zum PDF: Ein Sonntag mit nur einer Arbeitskraft sieht leer aus. Das ist so gewollt. Bei drei Mitarbeitern wird es anders aussehen. Nichts ändern.

## 2. Wochenansicht pro Mitarbeiter (Vorbild: Clockodo „KW 46“)
- Sieben Tage nebeneinander (Mo bis So), Pfeile für die Kalenderwoche, Knopf „Heute“, Datumsauswahl für einen beliebigen Tag.
- Balken pro Abschnitt: Baustelle in der Farbe der Baustelle, **Fahrt gelb, Pause grau, Händler braun, Privat grau mit Wort „Privat“** (wie in der Tagesansicht). Materialfahrt mit Streifen.
- Unter jedem Tag: Stunden, Beginn bis Ende, Betrag. Ganz links die Wochensumme.
- **Mitarbeiter wechseln** oben beim Namen: Klick öffnet die Liste aller Mitarbeiter, ein Klick wechselt. So kann Wladi vergleichen.
- Chef sieht nur **abgegebene** Tage (siehe `auftrag-version-08-c-variante.md`, Schritt 3). Noch nicht abgegebene Tage zeigen den Hinweis „noch nicht abgegeben“.

## 3. Abschnitt anklicken und bearbeiten (Vorbild: „Zeiteintrag bearbeiten“)
- Klick auf einen Balken öffnet ein kleines Fenster mit Zeit, Betrag und Stundensatz, darin Knöpfe Bearbeiten, Teilen, Löschen.
- Bearbeiten-Fenster: Datum, Start, Ende, Dauer, Baustelle (Auswahl), Fahrtart, Stundensatz, Mitarbeiter, **Beschreibung** (bis 1000 Zeichen), Hinweis „Erstellt … Letzte Änderung …“.
- **Weglassen:** „Leistung“, „Ansprechpartner“, Farbkreise mit Kürzeln.
- **Originale im Hintergrund:** Jede Änderung speichert still den alten Wert und den Zeitpunkt (wie in der Datenschutz-Entscheidung 3a). Nichts wird überschrieben oder gelöscht (mindestens 2 Jahre). Nicht im PDF, nicht in der Alltagsansicht.
- Eintrag **nachtragen** (auf leeren Tag klicken, Zeit ziehen): später. Solche Einträge bekommen den Vermerk „nachträglich eingetragen“ mit echter Uhrzeit des Eintrags. Nichts wird zurückdatiert.

## 4. Übersicht, Monat, Stundenkonto
- **Übersicht aller Mitarbeiter** (Vorbild Clockodo „Stundenkonto“): Tabelle mit Name und Stunden. Klick öffnet die Monatsansicht.
- **Monatsansicht:** Kalender mit jedem Tag, Stunden pro Tag, Summe pro Woche und pro Monat.
- **Kein festes Soll.** Wladis Leute arbeiten flexibel, zwischen etwa 10 und 50 Stunden pro Woche, je nach Auftrag. Darum **kein Plus/Minus gegen 8 Stunden, kein rotes Warnzeichen**. Nur die echten Stunden zeigen. Ein Soll pro Mitarbeiter ist später als freiwillige Einstellung möglich, jetzt nicht bauen.
- **Urlaub, Krankheit, Feiertage:** Noch nicht bauen. Vorher Wladi fragen.

## 5. Kundenmaske am Desktop (Vorbild: LexOffice „Neuer Kontakt“)
- Oben Umschalter **Person / Firma**.
  - Person: Anrede, Vorname, Nachname.
  - Firma: Firmenname. (Ansprechpartner bei Firmen später.)
- Adresse: Adresszusatz, Straße und Hausnummer, PLZ, Ort. Land fest Deutschland, nicht zeigen.
- E-Mail und Rufnummer, jeweils mit Auswahl privat/geschäftlich. Notiz.
- Kunden-Nr.: Feld bleibt leer („wird später aus LexOffice übernommen“).
- **Stundensatz** statt „Konditionen“: ein Satz für alle, pro Person abweichend möglich, änderbar ab einem Datum (wie im Bauplan).
- **Weglassen:** Sammelkunde, Social Media, Steuerangaben, E-Rechnung, Bankkonto.
- **Baustelle im selben Fenster:** Unten ein Häkchen „Baustelle ist an der Adresse des Kunden“, **standardmäßig an**. Dann legt Spur die Baustelle sofort mit an und verbindet sie mit dem Kunden. Ohne Häkchen erscheinen Felder für eine andere Baustellen-Adresse. Hat ein Kunde später eine zweite Baustelle: beim Anlegen der Baustelle den Kunden aus einer Liste wählen.
- Kachel am Handy: „Straße Nr · Nachname“ (bei Firma: Firmenname), Stadt nur bei gleichen Straßen.
- Die Felder müssen zum Import „Kontakte aus LexOffice holen“ passen (nur Richtung LexOffice → Spur, Knopf von Wladi).

## 6. Reihenfolge
1. Fehler Vorschau schließen (klein, sofort).
2. Wochenansicht mit Mitarbeiter-Wechsel.
3. Abschnitt bearbeiten mit stillen Originalen.
4. Kundenmaske mit Baustelle im selben Fenster.
5. Übersicht und Monatsansicht (ohne Soll).
Nach jedem Schritt testet Wladi.

## 7. Zuerst fragen, wenn unklar
- Zeigt die Wochenansicht auch Tage, die noch nicht abgegeben sind (mit Hinweis), oder nur abgegebene?
- Soll die Monatsansicht Fahrten und Pausen getrennt zählen oder nur die bezahlte Zeit?
- Urlaub, Krankheit und Feiertage: wann und in welcher Form?

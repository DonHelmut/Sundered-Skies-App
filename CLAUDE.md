# Sundered Skies – Initiative

Lokale Initiative-App für Savage Worlds: Sundered Skies. Python-Server (FastAPI +
WebSockets) auf dem Spielleiter-Laptop, Spieler per Handy-Browser. Frontend ist
reines HTML/CSS/JS ohne Build-Tools. Überblick: [README.md](README.md).
Stand, Entscheidungen und offene Punkte: **[ENTWICKLUNG.md](ENTWICKLUNG.md) –
zu Beginn lesen.**

## Arbeitsweise

- Wird auf **mehreren PCs** entwickelt. Vor dem Arbeiten `git pull`. **Stefan will
  alle Änderungen immer im Git haben:** jede abgeschlossene, getestete Änderung
  selbst committen und `git push`en (Nachricht mit Erklärung für den anderen PC,
  Eintrag in ENTWICKLUNG.md). Spielbare Pakete (.exe) als GitHub-Release per `gh`.
- Sprache: Deutsch (Antworten, Kommentare, Commit-Nachrichten).
- Stefan beurteilt Optik im Browser-Tab und entscheidet nach Ansicht: lieber
  Varianten zeigen als lange nachfragen.

## Befehle

```bat
.venv\Scripts\python -m pytest
.venv\Scripts\python -m server.run
```

Die Tests laufen in wenigen Sekunden. `server.run` startet im LAN mit QR-Code.
Optisches prüfen auf `http://localhost:8000/static/_lab.html` (Musterseite).
Über `localhost` ist man immer Spielleiter; die Spieleransicht braucht die
LAN-Adresse.

## Konventionen

- Kommentare erklären das **Warum**, oft mit der Vorgeschichte („sonst …").
  Diesen Stil beibehalten.
- Keine Browser-Dialoge (`confirm`/`alert`/`prompt`) – der Browser lässt sie sperren;
  stattdessen `frage`/`hinweis`/`eingabe` aus `app.js`.
- Kein animierter CSS-`filter` auf Karten (ruckelt beim Drehen); Leuchten wird
  mit Verläufen/`box-shadow` gemalt.
- Joker: `cards.js` (`JOKER_STILE`, `JOKER_NAMEN`, `JOKER_BAU`). Geparkte Stile
  in `web/static/joker-archiv.js`, das Spiel lädt sie nicht. Leitlinien in
  ENTWICKLUNG.md.
- Dateien mit `_lab*` in `web/static/` sind Entwickler-Werkzeuge und werden beim
  Paketbau herausgefiltert.
- Release: Version an drei Stellen erhöhen (`server/paths.py`,
  `web/static/app.js`, `?v=` in `web/index.html` + `web/tv.html`) plus
  `paket/START-HIER.txt`; Details in `paket/LIESMICH-ENTWICKLER.txt`.
- `data/` ist echter Spielstand und nicht im Git – beim Testen nicht
  versehentlich die gespeicherte Sitzung verwerfen (erste Aktion nach dem Start
  tut das).

# Entwicklung – Stand, Entscheidungen, offene Punkte

Arbeitsnotizen für die Weiterentwicklung auf mehreren PCs. Für Spieler und
Spielleiter ist die [README](README.md) da.

---

## Arbeitsweise mit mehreren PCs

Es gibt **eine** Quelle der Wahrheit: GitHub (`main`). Jeder PC arbeitet so:

1. **Vor dem Arbeiten holen:** `git pull`
2. Arbeiten, testen (siehe unten)
3. **Zum Schluss sichern:** `git add -A`, `git commit -m "…"`, `git push`

Nie auf zwei PCs gleichzeitig ungesicherte Änderungen liegen lassen – sonst
gibt es beim nächsten Pull Konflikte.

### Einrichtung auf einem neuen PC

```bat
git clone https://github.com/DonHelmut/Sundered-Skies-App.git
cd Sundered-Skies-App
start.bat
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m pytest
```

`start.bat` legt beim ersten Mal die `.venv` an, installiert alles und startet
den Server. Die zweite Zeile installiert die Test-Werkzeuge, die dritte führt
die 92 Tests aus.

Nicht im Git (bleibt pro PC): `.venv/`, `data/` (Charaktere, Bestiarium,
Sitzung, hochgeladene Bilder), `.claude/`. Charaktere und Bibliotheken lassen
sich über **Export/Import** in der App umziehen.

### Testen

- `.venv\Scripts\python -m pytest` – Server-Logik.
- Server starten: `.venv\Scripts\python -m server.run` (LAN, QR-Code).
- **Musterseite** für alles Optische: `http://localhost:8000/static/_lab.html` –
  alle Joker-Stile (aktiv + geparkt), Kartenstufen, Talent-Wechsel-Demo.
- **Spieleransicht** braucht ein zweites Gerät oder die LAN-Adresse
  (`http://<laptop-ip>:8000`) – über `localhost` ist man immer Spielleiter.
- Achtung: Die **erste Aktion** nach einem Serverstart verwirft die gespeicherte
  Sitzung („Fortsetzen?"). Vor Tests mit echten Daten erst fortsetzen.

---

## Änderungen vom 16.09.2026 (Version weiterhin 91)

### Karten-Optik
- Wertigkeits-Stufen nach dem Setting statt nach Metall: **GLUT** (2–5),
  **ASCHE** (6–9), **GLANZ** (10/B/D/K), **LEERE** (A). Schlüssel intern weiter
  `bronze/silver/gold/platin`, damit CSS und App unverändert greifen.
- Haarrisse in den Kartenecken statt Zierblättern, Splitter statt Edelsteine,
  Tinte etwas kühler.

### Talente sichtbar machen
- **Talent-Spur** in der Initiative-Liste und auf dem TV: verworfene Karten
  durchgestrichen, behaltene hervorgehoben (z. B. ~~K♠~~ → **8♥** bei Zögerlich).
  `Cards.trail()` in `cards.js`, genutzt von `app.js` und `tv.js`.
- **Verwerfen-Animation** auf der Spieler-Großkarte in drei Takten: markieren
  (Puls + Schild mit Begründung) → verglühen → neue Karte steigt auf.
  „Schnell" pulsiert kürzer (mehrere Nieten hintereinander). Beim SL gibt es
  die Animation bewusst nicht.

### Initiative-Reihenfolge
- Spieler sehen die Reihenfolge erst, wenn **ihre eigene Karte aufgedeckt** ist
  (vorher Hinweis). Gesperrt bleibt sie auch während der Aufdeck-Animation.

### Joker
- Komplett neu gestaltet; der Joker darf aus der Karte **ausbrechen**
  (`.joker-aussen`, in Listenkarten/TV-Kacheln ausgeblendet, klickdurchlässig).
- **Im Spiel:** ✴️ **Riss** (Favorit – mit Ausbruch alle 4,5 s),
  🔯 **Siegel** (Runenkreis unter der Karte), ✨ **Glyphen** (Runen laden sich
  auf, Karte leuchtet), 🪐 **Orbit** (gekreuzte Runenringe).
- **Auswahl** im ⚙-Menü unter „Joker-Stile": Standard Zufall aus allen, per
  Häkchen einschränkbar, pro Gerät. Der Stil steht je Joker und Runde fest
  (SL, Spieler und TV zeigen denselben).
- **Geparkt** in `web/static/joker-archiv.js` (vom Spiel nicht geladen, nur
  auf der Musterseite): Ritual (Siegel+Riss), Zerrissen, Entladung, Blitz,
  Splitter, Aura. Zurückholen: siehe Kopf der Datei.
- Funktioniert mit dunklen Charakterbildern (Glow leuchtet die Figur an) und
  ohne Bild (schwebende Felsinseln).

### Sonstiges
- README um fehlende Funktionen ergänzt; Fehler korrigiert (Statisten vertragen
  **2** Wunden, nicht 1).
- Paketbau (`*.spec`) filtert alle `_lab*`-Dateien aus der .exe.

---

## Gestaltungs-Leitlinien (aus den Joker-Runden)

- **Motiv nie verdecken** – besonders nicht die obere Bildmitte (Gesicht).
- **Muss mit dunklen Bildern funktionieren**, nicht nur mit hellen.
- **Kommt gut an:** Aufleuchten der ganzen Karte; alles, was **unter oder neben**
  der Karte passiert (Runenkreis); Risse / Zerreißen.
- **Kommt nicht an:** Flammen, die aus der Karte schlagen („gerupftes Huhn" –
  verworfen); kleine, schnell flackernde Blitze wirken grisselig; zu
  gleichmäßige Formen lesen sich als Kabel, Sägezahn oder Bleiglas.
- Technisch: Leuchten wird **gemalt** (Verläufe, breite halbtransparente
  Striche), nie per animiertem `filter` – das rastert pro Frame neu und ruckelt.
  Überstand seitlich höchstens ~40 Einheiten (Handy-Breite).

---

## Offene Punkte

- [ ] **Handy-Test** der Joker auf echten Geräten (am aufwendigsten: Orbit).
- [ ] **Version 91 → 92** vor dem nächsten Release (`server/paths.py`,
      `web/static/app.js`, `?v=` in `web/index.html` + `web/tv.html`,
      `paket/START-HIER.txt`).
- [ ] Stufen-Schild auf den kleinen Listenkarten ist mit ~1,7 px unleserlich
      (war es vorher auch) – Vorschlag: dort ausblenden.
- [ ] TV-Ansicht zeigt **alle Karten sofort offen**, auch wenn Spieler ihre
      noch nicht aufgedeckt haben – widerspricht evtl. der neuen
      Reihenfolge-Sperre. Klären, ob gewollt.
- [ ] Geparkte Joker-Stile ggf. später weiterentwickeln (Ideen: Zerrissen noch
      feiner, Entladung als Alternative zu Blitz).

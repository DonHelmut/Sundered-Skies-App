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

## v98 (23.09.2026): Übersicht für SL und Spieler, Beitritt, Archiv

**SL**
- Leertaste teilt am Rundenende (und vor der ersten Runde) die nächste Runde aus.
- „Neue Runde" nur groß, wenn er dran ist; mitten in der Runde klein. Phasen-Pille
  oben entfällt, solange die Leiste unten dasselbe sagt.
- „↓ danach" an der Zeile des nächsten Akteurs, erledigte Zeilen stärker abgeblendet
  (nur Deckkraft – ein Filter würde beim Umsortieren pro Frame neu rastern).
- Filter **„nur Offene"** in der Reihenfolge ab 9 Figuren (`App.nurOffene`).
- Begegnung **„▶ Starten"** (`start_encounter`): optional alte Gegner ersetzen,
  pausierte Spieler zurückholen, austeilen – in einem Schritt.
- Verlauf: **🔁 nochmal senden** und **📺 auf den TV**, dazu ein **Bild-Archiv**
  aller verschickten Bilder; Verlaufsbilder nur noch als Vorschau.
- Panel-Ziehen: leere Spalte war 0 px hoch und damit kein Ziel mehr – beim Ziehen
  bekommen beide Spalten Mindesthöhe und „Hierher ziehen" (`body.panel-zieht`).
- Fix: `benutzte_bilder()` las beim TV-Bild `url` statt `imageUrl`; ein gerade
  gezeigtes Bild galt als verwaist und wurde aufgeräumt.

**Spieler**
- Beitritt: **„➕ Neuen Charakter anlegen"** (`charakter_anlegen`, Namensdublette
  greift auf den vorhandenen Charakter zurück).
- Lange Listen: nur der Ausschnitt um das Geschehen + eigene Figur, Rest hinter
  „▾ Alle N zeigen"; Zonen-Board startet ab 13 Figuren eingeklappt.
  (Testkampf mit 25 Figuren: Seite von 5600 px auf 2550 px.)
- „Du bist 2. von 25 · noch 1 vor dir", eigene Zeile mit „Du"-Abzeichen,
  mitlaufende Leiste oben „… ist dran" (sticky unter der Verbindungs-Pille).

## v97 (19.09.2026): Sicherung mit Bildern, Rundenzähler

- **Sicherung als Zip** (`server/sicherung.py`): `sicherung.json` + `uploads/<bild>`
  für alle Bilder aus Charakteren, Bibliotheken und Begegnungen. Import nimmt Zip
  und alte JSON; nur Dateinamen im Upload-Muster werden entpackt (kein Pfad-Trick),
  Größen gedeckelt. Tests: `tests/test_sicherung.py`.
- **Rundenzähler** „Runde N" beim SL links in der Leiste und beim Spieler oben
  rechts; pulsiert kurz beim Rundenwechsel (`rundenZaehler`).

## v96 (19.09.2026): Talente selbst wählen, Regel-Spickzettel, Statisten-Regel

- Spieler haken ihre **Initiative-Talente** (Schnell, Kühler Kopf …) und **Glück /
  Großes Glück** im Charakterbogen selbst an (`talents_update`, kein Undo-Eintrag,
  am Roster gespeichert). Kühler + Sehr Kühler Kopf -> nur das stärkere.
- **Regel-Spickzettel** „❔ So geht Angriff & Schaden" im Reiter Kampf
  (`regelTipp`): Treffen gegen Parade / 4, Schaden gegen Robustheit, Joker, Wunden …
  setzt eigene Werte aus dem Bogen ein.
- **Statisten raus bei der 1./2./3. Wunde** stellt der SL in ⚙ ein (`statisten_ko`,
  Standard 3, gespeichert + in der Sicherung). Wild Cards immer bei der 4.

## v95 (19.09.2026): Kampf abräumen, Bennies, Effekte, Charakterbogen

- **🧹 Kampf abräumen** (`clear_all`): Gegner/Verbündete weg, Spieler nur pausiert
  (bleiben verbunden), Gruppen weg, danach wie „Zurücksetzen". Dazu
  **▶️ Alle wieder rein** (`unbench_all`) an „Nicht im Kampf".
- **Bennies** am Roster-Charakter gemerkt (`_bennies_merken` nach jeder Aktion).
  Verteilen: „🪙 +1 Benny" im Panel „Nachricht / Bild / Bennies" (Nachricht mit
  `bennies: 1`). Benny-Panel entfernt; SL-Pool + Auffrischen im Nachrichten-Panel,
  Startwert in ⚙ Kampf-Einstellungen. Bewusst schlank halten (Stefan).
- **Panels selbst anordnen** (nur SL): Überschrift ziehen, auch zwischen den
  Spalten; `PANEL_BAU`/`STANDARD_ANORDNUNG`, localStorage `panelAnordnung`.
  Neue Panels dort eintragen, sonst erscheinen sie nicht.
- **Dauer-Effekte** (`effect_add/remove/adjust`): zählen bei jeder NEUEN Runde
  runter, SL bekommt beim Ablauf einen Hinweis.
- Spieler: **Sekunden-Ring nur bei dem, der dran ist**; Vorwarnung **„Gleich bist du
  dran"** (+ kurze Vibration).
- **Charakterbogen** (Spickzettel, Reiter Kampf/Werte/Talente/Ausrüstung) auf dem
  Handy – nur die Spieler tragen ein (`sheet_update`, kein Undo-Eintrag, gespeichert
  am Charakter). Während des Tippens wird nicht neu aufgebaut. Entwurf:
  `_lab-spickzettel.html`. Offen: SL sieht die Bögen noch nicht.
- **Fix Neustart:** Handys meldeten sich nach einem Server-Neustart sofort wieder
  an und überschrieben dabei die gespeicherte Sitzung; „Fortsetzen?" verschwand.
  Jetzt: `save_session` schweigt solange `resume_available`, Spieler-Aktionen
  zählen bis dahin nicht, Handy behält seine Spieler-ID, Hinweis bleibt sichtbar.
- Paket: nur noch **eine** Datei (Ordnerversion als `SunderedSkies-App.zip`).

## v94 (18.09.2026): Aufdecken ohne Ruckeln, Joker bleibt geheim

- Kein `transition: filter` mehr auf `.card-svg` (war ein animierter Filter bei
  jedem Aufdecken). Aufdeck-Leuchten als feste Ebene `.flip-inner::before`,
  animiert wird nur `opacity`.
- Aufdeck-Sperre reicht bis zum Ende der langsamsten Animation (`revealDauer`).
- `render()` baut nicht neu, wenn das HTML gleich ist; SVG-IDs dafür pro Aufbau
  ab 1 (`Cards.renderStart/renderEnde`), außerhalb ab einer Million.
- Joker verrät sich beim Spieler nicht mehr vor dem Aufdecken: kein „JOKER!"
  beim Austeilen, kein Goldpulsieren/Ausbruch der verdeckten Karte, keine
  Karten-Hinweise darunter. SL und TV bleiben bewusst wie sie sind.

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

### Verbindung: Handys springen auf Mobilfunk
- Anlass: Beim Gastgeber fiel das Internet aus (WLAN blieb) – die Handys flogen
  raus. Ursache: Handys schicken bei „WLAN ohne Internet" alles über Mobilfunk
  und finden den Laptop nicht mehr. Der Server selbst braucht kein Internet.
- **Erkennung** (`aufMobilfunk()` in `app.js`, über `navigator.connection` –
  nur Chrome/Android; iPhone kennt das nicht): Der Verbindungs-Hinweis zeigt
  dann sofort „Dein Handy ist auf Mobilfunk umgesprungen" mit Lösung. Wechselt
  das Netz zurück aufs WLAN, wird sofort neu verbunden. Im Log steht danach
  „wieder verbunden (war auf Mobilfunk)".
- **Vorbeugender Tipp** auf der Beitrittsseite (nur Touch-Geräte):
  Flugmodus an, danach nur WLAN wieder an.
- Getestet mit vorgetäuschtem Netztyp und gestopptem Server; auf einem echten
  Handy mit ausfallendem Internet noch nicht (zu Hause nachstellbar: am Router
  das Internetkabel ziehen, WLAN anlassen).

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
- [x] ~~Version 91 → 92~~ – erledigt; **aktueller Stand ist v98** (veröffentlicht).
      Nächstes Release also 98 → 99 (`server/paths.py`, `web/static/app.js`,
      `?v=` in `web/index.html` + `web/tv.html`, `paket/START-HIER.txt`).
- [ ] Stufen-Schild auf den kleinen Listenkarten ist mit ~1,7 px unleserlich
      (war es vorher auch) – Vorschlag: dort ausblenden.
- [ ] TV-Ansicht zeigt **alle Karten sofort offen**, auch wenn Spieler ihre
      noch nicht aufgedeckt haben – widerspricht evtl. der neuen
      Reihenfolge-Sperre. Klären, ob gewollt.
- [ ] Geparkte Joker-Stile ggf. später weiterentwickeln (Ideen: Zerrissen noch
      feiner, Entladung als Alternative zu Blitz).

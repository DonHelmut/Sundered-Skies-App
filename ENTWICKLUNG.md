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
alle Tests aus.

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

## 1.5.2 (30.09.2026): Mimi neu gezeichnet, versorgen, dosierter Schabernack

- **Neues Aussehen** (`catSVG` in mimi.js; aus Variante A in `_lab_mimi.html`
  weiterentwickelt, Stefan: „mehr Bengale, feiner"): goldene Bengalkatze mit
  zweifarbigen Rosetten (rostroter Kern, unterbrochener dunkler Rand),
  kleinen runden Ohren, großem grünem Auge mit Goldrand, EINER Linie vom Auge
  zur Backe, heller Schnauze/Bauch, zart gestreiften Beinen, geringeltem
  Schwanz mit schwarzer Spitze; feine Linien (1,0). Großer, glatt fallender
  roter Umhang mit Goldborte und Spange (die Fetzen-Version wirkte laut
  Stefan „wie ne Obdachlose"). Beine als geformte Pfade mit Pfote/Zehen
  (Rechtecke wirkten wie Stelzen). Schnurrhaare von der Schnauze nach hinten
  über die Backe. Noch in Abstimmung mit Stefan.
- **Versorgen**: Antippen öffnet ein Menü 🍖 Futter · 💧 Trinken · 🧶 Spielen
  · ✋ Streicheln (schließt nach 6 s oder bei Klick daneben). Wünsche zeigt sie
  nur leise („miau?"), im Menü leuchtet der Wunsch. Versorgt ist sie eine
  Weile zufrieden (`ruhigBis`: 1–3 min) – dann keine Streiche.
- **Schabernack, der kurz etwas verstellt** (nur Optik, dreht sich selbst
  zurück, nichts wird geklickt/gespeichert/gesendet): Knopf „drücken",
  Design kurz umschalten (zurück auf `localStorage.skin`), Licht aus mit
  leuchtenden Augen, zwei Zeilen vertauschen, Pfotenspur; dazu Wollknäuel.
  Dosierung nach Stefans Rückmeldung: Pausen 6–13 s, verstellende Streiche
  mit 36 % Chance und mindestens 50 s Abstand, nie bei Eingaben/Dialogen/
  eigenem Zug (`beschaeftigt()`); am Handy ohne Umfärben/Bildschirm-Dreher
  („Licht aus" ist am Handy okay).
  Beim Ausschalten wird alles Verstellte sofort zurückgesetzt (`spaeterZurueck`).
- Läuft auch am Handy (⚙ → 🐈, pro Gerät).
- `window.mimiStreich(name)` löst Streiche/Versorgen gezielt aus (Ausprobieren).
- Behoben am Rand: `/api/info` und `/qr.png` nehmen den Port der Anfrage
  (`_port_von`) – ein direkt mit uvicorn gestarteter Server (Testserver 8765)
  zeigte sonst :8000 im QR-Code. Mit `server.run` war es schon richtig.

## 1.5.1 (30.09.2026): Ladebalken beim Aktualisieren

- `Aktualisieren.exe` zeigt beim Download einen Balken, der sich in derselben
  Zeile füllt (`fortschritt_balken`, ``, höchstens ~12×/s neu gezeichnet):
  `[██████████░░░░░░░░░░]  52 %   13,4 / 25,9 MB` – statt zehn Zeilen „… 10 %".
  Ohne echtes Konsolenfenster (umgeleitet/Tests) nur jede 10 % eine Zeile mit
  `#`/`-` (cp1252 kennt █/░ nicht); `stdout` zusätzlich mit `errors="replace"`.
- Der neue Updater kommt beim nächsten Update als `*.neu` und wird beim
  nächsten App-Start eingesetzt – den Balken sieht man also ab dem Update
  NACH 1.5.1.

## 1.5 (30.09.2026): Kämpfe vorbereiten

- Bibliothek-Reiter „Begegnungen" heißt jetzt **„Kämpfe"** (Schlüssel bleibt
  `encounters`). „➕ Kampf vorbereiten" öffnet einen Baukasten im Reiter –
  der laufende Kampf bleibt unberührt (`App.kampfEntwurf`, übersteht
  Neuzeichnen; `.kampf-bau` im Tipp-Schutz):
  - **Charaktere** aus der Charakterliste mit Häkchen + **Startzone** (neu
    angelegt: alle dabei – wer fehlt, wird im Spiel per Rechtsklick entfernt).
  - **Gegner/Verbündete** aus den Bibliotheken: Anzahl −/+, Zone, „verdeckt".
    Gleiche Figuren werden zu „Skree ×4" zusammengefasst (`vorlage`).
  - **Notiz (nur SL)** – erscheint beim Starten als Einblendung.
- Liste: ▶ Starten · + dazu (Verstärkung ohne Austeilen) · ✎ · ⎘ Kopie · ✕.
  „💾 Laufenden Kampf merken" speichert jetzt auch die Charaktere mit Zone.
- **Schnellstart**: Ist kein Gegner im Kampf (Sitzungsbeginn, nach „Kampf
  abräumen"), steht über dem Austeilen-Knopf „Vorbereitet: [Kampf ▾] ▶".
- Server: `encounter_upsert` (bereinigt alles vom Browser, verwirft unbekannte
  Charaktere, Verbündete nie verdeckt), `encounter_copy`; `add_encounter` /
  `start_encounter` setzen Charaktere an ihre Startzone – anwesende rücken
  dorthin, fehlende kommen aus der Liste (ohne Spieler); tritt der Spieler
  später bei, übernimmt er die Figur. Test:
  `test_kampf_vorbereiten_mit_charakteren_und_starten`.

## 1.4.8 (30.09.2026): Eigene Illustration als Standard-Rückseite

- Neue Standard-Rückseite `web/static/rueckseite.svg`: eigene, prozedural
  gezeichnete Illustration (gespaltene Tempelinsel im Gegenlicht, Lichtkranz,
  Trümmer, Tafelberge mit Spiegelung) – kein fremdes Bild, darf also ins
  öffentliche Repo. Erzeugt von `werkzeuge/rueckseite_zeichnen.py` (fester
  Zufallssamen, Kanten fraktal); zum Nachbessern dort ändern und neu erzeugen.
  Darstellung wie Variante „B" (Bronzerahmen, unten Kompass).
- ⚙ beim SL: „🖼 Bild wählen / Standard / Grün". `rueckseiteBild`: None =
  Standard-Illustration, "gruen" = schlichte grüne Rückseite, sonst ein
  hochgeladenes Bild (bleibt nur lokal in data/uploads).
- Stefans Vorlagenbild (fremde Kunst) ist bewusst NICHT im Repo; wer es
  nutzen will, lädt es über „Bild wählen" lokal hoch.

## 1.4.7 (30.09.2026): TV passt immer auf einen Bildschirm

- Stefan: Am TV/Beamer wird NIE gescrollt – alles muss auf eine Bildschirmseite,
  je nach Auflösung und Größe anders.
- `tv.html` hat `body.tv-modus` (100vh, overflow hidden). Aufbau quer: oben
  Runde/Timer, links „Am Zug" (große Karte) + Reihenfolge, rechts das
  Zonen-Board als eigene Spalte über die ganze Höhe (in einer flachen Reihe
  wurde es bei vielen Figuren briefmarkenklein). Hochkant: untereinander.
- `einpassen()` in tv.js (nach jedem render und bei resize): misst das
  Seitenverhältnis einer Kachel, wählt die Bühnenhöhe so groß wie möglich,
  solange die Kacheln lesbar bleiben (≥ min(150 px, Breite/9)), und die
  Spaltenzahl mit den größten Kacheln (`--kachel-b`, `--spalten`); skaliert
  das Zonen-Board (transform) in seine Spalte (höchstens ~34 % der Breite).
- Nachgemessen mit 25 Figuren: 1024×768, 1280×720, 1920×1080, 3840×2160 und
  hochkant 1080×1920 – nichts ragt heraus, nichts scrollt.
- Gegnernamen auf den Kacheln in `--foe-name` (vorher festes Hellrosa, auf
  Pergament kaum lesbar).

## 1.4.6 (30.09.2026): Eigenes Bild als Kartenrückseite

- ⚙-Menü beim SL (nur Laptop, `.nur-sl`): „Kartenrückseite (für alle) – 🖼 Bild
  wählen / Standard". Das Bild wird hochgeladen und liegt nur in
  `data/uploads` (Einstellung `rueckseiteBild` in settings.json) – kommt also
  nie ins öffentliche Repo oder Paket. Stefans Vorlage ist fremde Kunst mit
  ungeklärten Rechten, darum so statt fest eingebaut.
- Gestaltung „B" (Stefans Wahl aus `_lab_rueckseite.html`, nur lokal):
  `rueckseiteMitBild` in cards.js – Bild farbig im Bronzerahmen, unten
  abgedunkelt mit kleinem Kompass. Gilt für alle Karten ohne Charakterbild
  (Karten mit Charakterbild behalten ihr Porträt), Handys und TV gleich.
- Das Bild zählt beim „Alte Bilder aufräumen" als benutzt. Test in test_game.py.
- Offen: Vorlage hat nur 236×363 px (auf Handy/TV unscharf); besser ein
  größeres, eigenes Bild (Prompt-Vorschlag im Verlauf 30.09.).

## 1.4.5 (30.09.2026): Eigene Rückfragen statt Browser-Dialoge

- Anlass: Beim Entfernen bot der Browser „Weitere Dialoge von localhost:8000
  verbieten" an. Wer das anklickt, bekommt auf jedes `confirm()` sofort still
  „Abbrechen" – Entfernen, Abräumen, Zurücksetzen, Löschen taten nichts mehr.
- Alle `confirm()`/`alert()`/`prompt()` in `app.js` ersetzt durch eigene
  Dialoge (`dialog`, `frage`, `hinweis`, `eingabe`; hängen an `<body>`, nicht
  an `#app`). Enter = Standardknopf, Esc / Klick daneben = Abbrechen; solange
  einer offen ist, bekommt die SL-Tastatur nichts (Leertaste gab sonst frei).
  Löschen/Entfernen mit rotem Knopf. „Begegnung starten" hat jetzt drei klare
  Knöpfe (Abbrechen / Dazustellen / Alte entfernen & frisch starten) statt
  „OK = … / Abbrechen = dazustellen".
- Regel ab jetzt: im Frontend kein `confirm`/`alert`/`prompt` mehr.

## 1.4.4 (30.09.2026): Offene Tabs laden sich nach einem Update selbst neu

- Anlass: Nach dem Update auf 1.4.3 kam „Probe Schnell" trotzdem wieder – ein
  seit Stunden offener Browser-Tab auf dem Laptop lief noch mit dem Seiten-Code
  von 1.4.2 und verband sich mit alter Logik neu.
- Der Server schickt im `hello` seine Version; weicht sie vom geladenen Code ab,
  lädt sich die Seite einmal neu (`veraltetNeuLaden`, Beamer in `tv.js`
  genauso). Schutz gegen Endlosschleife: `sessionStorage.neuGeladenFuer` –
  hängt der Cache trotzdem, bleibt der bekannte „Alte Seite im Cache"-Hinweis.
- Greift erst für Tabs, die schon 1.4.4-Code haben: Tabs von vor 1.4.4 einmal
  von Hand schließen/neu laden.
- **Behoben: „☰ Mehr" war unsichtbar.** Die Kopfleiste verlängerte ihren
  Hintergrund per `box-shadow` + `clip-path` bis an den Fensterrand – der
  `clip-path` schnitt aber auch das aufgeklappte Menü unter der Leiste ab. Jetzt
  per `.sl-kopf::before` (seit 1.0 so, fiel erst jetzt auf).

## 1.4.3 (30.09.2026): Kein stilles Wiederbeitreten fremder Geräte

- Anlass: Im frisch entpackten 1.4.2 (leerer `data`) stand beim ersten Start
  „Probe Schnell" als Gast im Kampf – ein Browser auf dem Laptop hatte ID und
  Namen aus einem alten Test gemerkt und meldete sich beim Verbinden still an.
- Das automatische Wiederbeitreten schickt jetzt `auto: true`; der Server nimmt
  es nur von Geräten an, die er kennt (laufende Sitzung oder gespeicherte, die
  auf „Fortsetzen" wartet – `Game.spieler_bekannt`). Sonst `joinError` mit
  `grund: "unbekannt"`: das Handy vergisst die alte ID und zeigt die normale
  Beitrittsseite. Von Hand beitreten geht wie immer. Test in `test_ws.py`.
- Das Paket selbst war sauber (kein `data`, keine Charaktere) – geprüft.

## 1.4.2 (30.09.2026): Aktualisieren als .exe

- **`Aktualisieren.exe`** statt `.bat` (Stefan: einfacher für Anwender). Quelle
  `aktualisieren.py` (nur Standardbibliothek), gebaut mit `Aktualisieren.spec`
  als Ordnerversion mit eigenem Unterordner `_aktualisieren` (Einzeldatei-.exe
  würde aus %TEMP% starten → auf Firmen-Laptops blockiert).
- Sich selbst kann der laufende Updater nicht überschreiben: neue
  Updater-Dateien kommen als `*.neu` daneben, die App setzt sie beim nächsten
  Start ein (`updater_nachziehen` in `server/run.py`) und räumt die alte
  `Aktualisieren.bat`/`.ps1` weg.
- Erkennt die laufende App an der gesperrten `_internal\python3*.dll` und
  beendet sie auf Nachfrage (`taskkill`). Tests: `tests/test_aktualisieren.py`.

## 1.4.1 (30.09.2026): Repo öffentlich, Aktualisieren.bat, Fanprojekt-Hinweise

- **Repo ist öffentlich** (Stefan, 30.09.). `main` geschützt: kein Force-Push,
  kein Löschen; andere nur per Fork + Pull Request mit Freigabe durch Stefan
  (Admins dürfen weiter direkt pushen). Commit-Mail bleibt sichtbar (bewusst).
- **`Aktualisieren.bat` + `Aktualisieren.ps1`** im Paket: holt das neueste
  Release, vergleicht mit der Versionszeile in `START-HIER.txt`, beendet auf
  Nachfrage die laufende App, tauscht alles außer `data`. Man bleibt für immer
  im selben Ordner. Braucht das öffentliche Repo (keine Anmeldung).
- **Fanprojekt-Hinweise**: README (mit Satz aus der Savage-Worlds-Fan-License),
  START-HIER.txt, in der App unter der Versionszeile und auf der Beitrittsseite.
- Versionen dürfen jetzt dreistellig sein (1.4.1); `[version]` im Updater
  vergleicht das richtig.

## 1.4 (30.09.2026): TV deckt nicht mehr vor, Stufen-Schild auf Listen-Minis

- **TV-Ansicht deckt nicht mehr vor:** Spielerkarten liegen dort verdeckt, bis
  der Spieler am Handy aufdeckt (Gegner wie gehabt sofort offen); Karten-Spur
  und ★ JOKER erst dann. Der Joker-Moment am TV feuert beim AUFDECKEN eines
  Jokers, nicht mehr beim Austeilen (`tv.js`: `offen(c)`, `TV.jokerGesehen`).
  Vorher verriet der TV die Karte vor dem eigenen Aufdeck-Moment und hebelte
  die Reihenfolge-Sperre der Handys aus.
- **Stufen-Schild** (GLUT/ASCHE/…) auf den Mini-Karten der Liste ausgeblendet
  (`.combatant .mini .stufen-schild`) – dort war es ~1,7 px hoch. Große Karten
  und TV unverändert.
- Joker im Handy-Format (375 px) nachgemessen: kein Stil macht die Seite
  breiter; Riss ragt am weitesten (±45 px), wird am Rand sauber abgeschnitten.

## 1.3 (28.09.2026): Zielwahl nach Standort, Fernkampf-Regel, Fehler aus dem Großtest

- **Zielwahl am Handy** (`angriffWahlHtml`): eigenes Vollbild-Blatt
  (`.angriff-blatt`) statt Liste über den Zonen – vorher hakte das Scrollen bei
  vielen Gegnern und überlagerte die Zonen. Gegner gruppiert danach, wo sie
  STEHEN (nah → fern), eigene Seite abgetrennt und zugeklappt. Scroll-Stand
  übersteht Server-Updates (`data-scroll-merk`, `blattScrollt`).
- **Stefans Fernkampf-Regel** (`fernkampfAbzug`, `angriffsArt`): Nahkampf nur,
  wenn beide in der Mitte. Fernkampf: stehen beide höchstens im Fernbereich
  (egal welche Seite) ±0 – der Fernbereich ist der Platz der Fernkämpfer; einer
  im Weitbereich −2, beide −4, außer Reichweite ✗. Schuss ins Getümmel: ⚠.
- **Großtest** (Zufalls-Stresstest + Szenarien im Browser) – behoben:
  - Gruppenkarte: Entfernen einer Kopie legte die Karte doppelt ab (55 Karten).
  - Stapel blieb nach der „zweites Deck"-Notlösung doppelt → `_deal` heilt ihn.
  - Handys bekamen Begegnungen und Verbündeten-Bibliothek mit (Leck).
  - Begegnung „ersetzen" ließ Gruppen-Zuordnungen hängen; gespeicherte
    Begegnungen vergaßen „verdeckt".
  - Rechtsklick auf Gruppenzeile traf nur die erste Figur (klappt jetzt auf);
    Rechtsklick auf Board-Token öffnete zusätzlich das Info-Fenster; „Treffer" →
    Ziel auf dem Board anklicken ging mit echter Maus nie.
  - Undo über einen Wiederbeitritt holte den alten Verbindungsstatus zurück →
    Spieler sah den eigenen Charakter als „wird gespielt". `_restore` behält
    jetzt, wer gerade verbunden ist; ebenso `resume_session` („Fortsetzen").

## 1.2 (28.09.2026): Handy-Daumen-Knopf, Beitritt in einem Tippen, SL-Rechtsklick

- **Beitritt in einem Tippen** (`renderJoin`, `doJoin(characterId, neu)`):
  „Weiter als Tessa" groß (gemerkt in `localStorage.letzterCharakter`, übersteht
  „Verlassen"), sonst Kacheln je Charakter (antippen = drin), „➕ Neuer
  Charakter", „👁 Nur zuschauen". Spielername optional (`spielerName`).
  Anlass: Neuer Charakter ging „manchmal" nicht – Server-Update während des
  Tippens baute die Seite neu, Auswahl und Name waren weg; bzw. Name im falschen
  der zwei Felder → alert, nichts gesendet. Jetzt `App.joinEntwurf` +
  `.join-form` in `tipptImBogen`.
- **Daumen-Knopf** am Handy (`daumenKnopf`): EIN großer Knopf unten, je nach
  Lage Eingreifen → Erholen → Angreifen/Zug bestätigen → Karte aufdecken; Zug
  beenden/Abwarten/Benny klein daneben. Während ein Angriff beim SL liegt, kein
  „Zug beenden".
- **SL: Rechtsklick auf Figur** (Zeile oder Token): Menü mit Treffer
  Erfolg/+1/+2/+3, Heilen, Angeschlagen, K.O., Zustände, Bennies, Aktiv setzen,
  Abwarten, Neu ziehen, Bearbeiten, Verdecken, Pausieren, Entfernen
  (`kontextMenueHtml`). Shift+Rechtsklick = Browser-Menü. Esc/Scrollen schließt.
- **iPhone:** Ton wird bei jeder Berührung freigeschaltet (`tonWecken`) – vorher
  entstand der AudioContext ohne Geste und blieb stumm. Vibration kann iOS im
  Browser nicht → stattdessen blitzt der Bildschirmrand golden (`dranBlitz`,
  für alle). „▶ Test"-Knopf neben dem Glocken-Häkchen. Lautlos-Schalter am
  iPhone schaltet Web-Töne weiterhin stumm.
- **Ausgeschaltete Gegner** bekommen beim Austeilen keine Karte mehr, sondern
  verschwinden aus dem Kampf (`_deal` ruft `_do_clear_defeated`). Bis dahin
  bleiben sie sichtbar (Fehlklick heilen / ↶). Verbündete und Spieler bleiben.
  Der Knopf „🧹 … entfernen" räumt weiterhin sofort ab.
- **Angriffs-Fenster (SL):** Parade und Robustheit des Ziels groß als zwei
  Kästen (Robustheit mit „davon X Panzer"), nur wenn eingetragen – vorher nur
  ein kleines „P 6 · R 8(2)".
- **Erholen gilt sofort** (Probe geschafft oder Benny, `_do_request`): keine
  Anfrage mehr, der SL bekommt nur eine Einblendung (`effekt_meldungen` mit
  `icon`). Andere Anfragen laufen weiter über den SL.
- **Daumen-Knopf gegen Doppeltipp:** nach „Erholt" sofort „✓ Erholung gemeldet
  ⏳" (`App.erholGetippt`); wechselt der Knopf, zählt ein Tipp in den ersten
  0,7 s nicht (`App._daumenSeit`). Anlass: Knopf blieb kurz gleich, dann stand
  an derselben Stelle „Angreifen" – zweiter Tipp griff ungewollt an.
- **Zielwahl als Blatt über dem Daumen-Knopf** (`.dl-blatt`) statt oben in der
  Karte – das Hinscrollen klappte am Handy nicht.
- **Beitritt:** Charaktere, die gerade ein anderes verbundenes Gerät spielt,
  sind ausgegraut „wird gespielt" (`charakterBelegt`); „Weiter als …" nur, wenn
  frei. „➕ Neuer Charakter" auch direkt unter „Weiter als …". Nach Ablehnung
  durch den Server zeigt die Seite die Liste.
- **SL-Zeile:** Wird es eng, kürzen sich Zone und „↓ danach" – WC, Talente und
  Bennies wurden vorher hinten abgeschnitten. Zeilenhöhe unverändert.
- **Charakter erstellen gut sichtbar:** eigener großer grüner Knopf „＋ Neuen
  Charakter erstellen" unter einer „oder"-Linie (in „Weiter als …" und in der
  Liste); die Erstell-Seite heißt „➕ Neuen Charakter erstellen", Knopf
  „Charakter erstellen & beitreten" (vorher nur „Beitreten" – las sich beim
  ersten Start, als fehle etwas).
- **Zug-Uhr hält an**, sobald der Spieler „⚔ Angreifen" tippt (Aktion
  `timer_halt`, kein Undo-Schritt), einen Angriff meldet oder sich erholt
  (`_timer_anhalten`) – er muss ja würfeln. Handy zeigt „⏸ Uhr angehalten",
  SL-Leiste „⏸". Der Zug endet mit „Zug beenden", über den SL oder nach dem
  Angriff. 6 s bleiben Standard (Stefan).
- **Eigener Haken „⚔ Spieler greifen am Handy selbst an"** unter Optionale
  Kampfhilfen (`spielerAngriff`, Standard an) – unabhängig von „Spieler dürfen
  anfragen". Stefan probiert aus, ob er es behält. Erholen ist keine Anfrage
  mehr und geht immer.
- Noch auf echtem iPhone prüfen: Ton nach Sperrbildschirm, Blitz, Daumen-Leiste
  über der Safari-Leiste.

- **Korrektur (Durchsicht 28.09.): Gruppenkarte doppelt im Deck.** Mitglieder
  einer Gruppenkarte tragen nur eine Kopie – Entfernen, Pausieren, „Ausgeschaltete
  entfernen" (jetzt auch automatisch beim Austeilen) und Begegnung ersetzen legten
  auch die Kopie ab, dann lag die Karte zweimal im Deck (55 Karten). Jetzt alles
  über `_karte_ablegen`. Test: `test_gruppenkarte_kopie_entfernen_verdoppelt_keine_karte`.
- **Korrektur: Rechtsklick auf „Ork ×10"** (Gruppenkarten-Zeile) öffnete das Menü
  nur für den ersten Ork – ein „+1"/„Entfernen" traf still nur ihn. Jetzt klappt
  der Rechtsklick die Gruppe auf („Rechtsklick auf den gewünschten Ork").

## 1.1 (25.09.2026): Spieler greifen selbst an

- **Handy „⚔ Angreifen"** statt „Zug bestätigen" (der bleibt klein als
  „Zug beenden"): Spieler wählt nur das ZIEL – Würfe/Schaden sagt er am Tisch an
  (Stefan). Zielwahl nach **Reichweite** von nah nach fern (`reichweite()` = die
  WEITERE der beiden Zonen, Stefans Logik), mit 😵/Wunden und Standort, verdeckte
  Gegner mit Tarnnamen. Ohne Anfragen-System (abgeschaltet) wie früher.
- **SL-Popup** (`angriffPopupHtml`): Daneben · Kein Schaden · Erfolg · +1/+2/+3,
  Häkchen „Zug danach beenden", „Später" (bleibt unter Anfragen, „⚔ Entscheiden").
  Mit Kampfhilfe „Schaden eintippen" ein Feld „Angesagter Schaden" + Vorschlag.
- Server `resolve_attack`: trägt ein, schickt dem Angreifer NUR das Ergebnis als
  Nachricht `sender: "kampf"` (Tarnname bei verdeckten Gegnern), beendet auf Wunsch
  den Zug. Handy zeigt das als großen Toast (`showKampfToast`), nicht blockierend;
  im SL-Verlauf ausgeblendet.
- Kampfhilfe „Spieler geben Schaden an" wieder entfernt (Stefan: nur Ziel melden).
- Versionen: nach 1.9 kommt 1.10, 1.11 … (kein Sprung auf 2.0).
- Gemerkt, nicht gebaut: **Arena** (Zonen als Ringe) – Vorschau `_lab_ideen.html`.

## 1.0 (25.09.2026): erstes „richtiges" Release – SL-Pult

Ab hier Versionsnummern 1.0, 1.1, … (bis v101 fortlaufend gezählt; Tags `v1.0` usw.).

**SL-Optik „Pult"** (nur Laptop, `body.sl-ansicht`; Handys unverändert)
- Feste Kopfleiste (sticky, über die volle Breite, `.sl-kopf`) statt großer
  Titelzeile; darin „Verbunden", ⚙ und das Menü **☰ Mehr** (TV-Modus, Sicherung
  exportieren/importieren, Bilder aufräumen, Version, ⌨ Tastenkürzel).
- Flache Panels mit farbigen Kapitälchen-Köpfen, Reihenfolge als durchgehende
  Liste, Zonen nach Seite getönt, leere Zonen nur ein Strich.
- Erklärtexte (Klasse `hilfe`) hinter einem **ⓘ** im Panel-Kopf (`App.hilfeOffen`).
- Kampf-Knöpfe in EINER Zeile (↶ ⟲ 🧹 als Symbole).
- **Ruhig beim Durchklicken:** alle Zeilen gleich hoch (nichts bricht um,
  Abzeichen werden abgeschnitten, Zustände nie), aktive Zeile nur Farbe – keine
  andere Größe; zweispaltig **spaltenweise** (`.order-raster`, `--zeilen`), damit
  beim Ausblenden Erledigter nicht jede Figur die Spalte wechselt; Auto-Scroll zur
  aktiven Zeile nur, wenn sie nicht sichtbar ist. Untere Leiste immer einzeilig
  (71 px), fester Platz für 😵/Wunden, „(NSC)" raus (Gegnername rot).
- **Zustands-Spalte** je Zeile: 😵, Wunden als Punkte ●○ (Grenze wie `max_wounds`),
  ☠ raus. 💥/🩹 nicht mehr in jeder Zeile (im ⋯-Feld und in der Leiste).
- Talente in der SL-Zeile nur als „✦ 3" (Tooltip), Spielername hinter dem Namen.

**Verschlankt, ohne Funktion zu verlieren**
- Charakterliste, Gegner, Verbündete, Begegnungen → EIN Panel „Bibliothek" mit
  Reitern (`BIB_REITER`, gemerkt in `localStorage.bibReiter`).
- Gruppen-Panel weg: Gruppenfelder direkt unter dem Zonen-Board (Drag&Drop,
  „+ Neue Gruppe" als Ablage), Klick öffnet Umbenennen/Bewegen/Auflösen
  (`gruppenMenueHtml`). Pausierte Figuren lassen sich dort nicht mehr gruppieren.
- „Damit die Verbindung hält" als zugeklappte Checkliste im Beitritts-Panel
  (`details[data-merk]`, offen/zu in `App.offeneUnter`).
- Nachricht/Bild/Bennies in drei flachen Zeilen, Verlauf zugeklappt.

**Panels verschieben:** beim Ziehen klappen alle auf ihre Überschrift zusammen
(`panel-kompakt`), Rand-Scrollen beim Ziehen (auch Figuren) – Touchpad kann beim
Halten nicht scrollen.

**Treffer**
- **🎯 Treffer** in der Leiste (Taste Z): Ziel antippen – in der Auswahl oder
  direkt im Board (`body.ziel-modus`). Stärke Erfolg / +1…+3 Steigerungen (Tasten
  0–3); Server `apply_hit` mit `steigerungen` (angeschlagen + je eine Wunde).
- Angriffs-Meldung der Spieler: „💥 Treffer…" öffnet die Auswahl, Ziel golden.
- **Kampfwerte** Parade/Robustheit/Panzer in Gegner-/Verbündeten-Vorlagen,
  Begegnungen und pro Figur (`_kampfwerte`); Spieler aus dem Charakterbogen.
- **Erholen** in der Leiste (✓ erholt / 🪙). Bennies nur für Wild Cards;
  **Gegner-Wild-Cards zahlen aus dem SL-Pool** (`_do_recover`). Probe am Tisch:
  Willenskraft oder Konstitution (Stefan).
- Handy: angeschlagen und dran → deutlicher Hinweis mit Knöpfen (schon vor der
  Freigabe).

**Optionale Kampfhilfen** (⚙ Kampf-Einstellungen, Standard aus, `set_kampfhilfe`)
- `schadenRechnen`: Schadensfeld in der Treffer-Auswahl, Steigerungen aus der
  Robustheit (darunter kein Schaden, je volle 4 darüber eine Steigerung).
- `spielerSchaden`: Spieler geben beim Angriff den Schadenswurf an (Prompt).
- `gruppenKarte`: gleiche Statisten (Seite + `_grundname`) teilen EINE Karte
  (`karteGeteilt` = Kopie, kommt nicht auf den Ablagestapel); gemeinsamer Zug
  (`_zug_fertig`), in der SL-Liste eine aufklappbare Zeile „Ork ×11"
  (`gruppenZeile`). Neu ziehen löst eine Figur aus der Gruppe.

**Sonst**
- Taste **?**: Übersicht aller Tastenkürzel.
- Formulare: „Wild Card"-Häkchen wieder neben dem Text (`label.field.row`).
- Tests: `ENCOUNTERS_FILE` wird im Test-Fixture jetzt auch umgeleitet (gespeicherte
  Begegnungen leckten in den nächsten Test).

## v101 (25.09.2026): WLAN des Laptops sichtbar

- Anlass: Bei einem Gastgeber kamen iPhones „manchmal" nicht rein (Seite lud gar
  nicht, nichts im Log), zu Hause nie. Befund vor Ort: zwei WLANs aus demselben
  Zugangspunkt – der Laptop hing in „Bengals!" (nur 2,4 GHz, Kanal 5, Wi-Fi 4,
  72 MBit/s), die Handys je nach Empfang im Hauptnetz „Regelanto!" (5 GHz). Nach
  dem Wechsel des Laptops ins Hauptnetz: Wi-Fi 5, ~390 MBit/s, Router-Ping 3 statt
  12 ms. Lösung am Tisch: alle ins selbe (5-GHz-)Netz; ob es das war, zeigt der
  nächste Abend dort.
- `winnet.wlan_info()` liest `netsh wlan show interfaces` (15 s gepuffert):
  Netz, Band, Kanal, Wi-Fi-Standard (4/5/6/6E/7), Raten, Signal. Die Ausgabe ist
  übersetzt („Bereich"/„Band", „Kanal"/„Channel" …) und kommt in der ANSI-
  Codepage (`mbcs`), nicht in der OEM-Konsolen-Codepage. Reiner Parser
  `wlan_aus_netsh()`, Tests in `tests/test_wlan.py` (echte deutsche Ausgabe).
- `/api/info` liefert `wlan`; die SL-Ansicht zeigt es unter der Adresse
  (`wlanHtml`), 2,4 GHz gelb mit Tipp. Beitrittsseite/QR bewusst unverändert.
- Netz-Wächter (`run.py`) schreibt „WLAN: …" beim Start und bei jedem Wechsel von
  Netz/Band/Standard ins Log (Rate und Signal allein zählen nicht).

## v100 (24.09.2026): Strg-Auswahl, Einstellungen bleiben, QR-Einladung

- **Strg-Auswahl sichtbar**: Strg-Klick markiert Gegner blau (eigene Farbe
  `--auswahl`, im Pergament-Schema war die Akzentfarbe zu schwach) – auch in
  der Reihenfolge. Zieht man eine markierte Figur, wandern alle markierten in
  die Gruppe (`group_assign_many`).
- **Ton + SL-Ansicht bleiben**: `soundEnabled` und `slAnsicht` (Schema,
  Panel-Anordnung, Eingeklapptes, Joker-Stile, Aufdecken) stehen in
  settings.json. localStorage hängt am Port – nach Portwechsel war sonst alles
  weg. `set_sl_ansicht` läuft ohne Undo und ohne das Fortsetzen zu verwerfen.
- **Einladung als QR-Bild**: WhatsApp macht Zahlen-Adressen nicht antippbar
  (und zeigte Emojis als „�"). Darum „🖼 QR-Bild kopieren" (Canvas 640×900 mit
  QR, Adresse, Hinweisen) bzw. „📤 Teilen…" mit Bild. Text ohne Emojis bleibt
  als Plan B. Bewusst kein Umweg über Internet-Dienste – bleibt lokal.
- **QR im ⚙-Menü jedes Handys**: Spieler zeigen den Code selbst weiter, statt
  dass alle den Laptop abfilmen.

## v99 (23.09.2026): Charakterbogen rechnet mit

- **Würfelwerte frei**: Attribute/Fertigkeiten als Eingabefeld statt Auswahl –
  „W6+2", „W8-1", beim Schaden auch „2W6+1". `wuerfel_wert()` in game.py und
  `wuerfelNorm()` in app.js normalisieren gleich; Unsinn wird rot markiert.
- **Ohne „W" tippen**: „6" wird beim Verlassen des Felds zu „W6", „6+2" zu „W6+2".
- **Attribute ausgeschrieben** (Geschicklichkeit (GE) …) als Liste statt fünf
  Kürzel-Kästchen – die Abkürzungen waren nicht eindeutig.
- **Waffen mit Art**: ⚔ Nahkampf / 🏹 Fernkampf, eigene Fertigkeit je Waffe,
  passende Platzhalter (St+W6 bzw. 2W6, Reichweite).
- **Würfel-Tipp je Waffe** (`wuerfelTipp`): „Kämpfen W8+1 + Wild-Würfel W6 gegen
  die Parade · Schaden W6+2+W4" – „St" wird durch den Stärke-Würfel ersetzt.
- **Parade und Robustheit automatisch** (`autoParade`, `autoRobustheit`):
  2 + halbes Kämpfen bzw. 2 + halbe Konstitution + Panzer; Plus zählt nur über
  W12. Nur wenn das Feld leer bleibt – eigener Wert gewinnt immer.
  Im Spickzettel dazu der Block „Deine Werte".

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
      Im Handy-Format nachgemessen: nichts macht die Seite breiter – offen bleibt
      nur, wie flüssig es auf echten Geräten läuft.
- [x] ~~Version 91 → 92~~ – erledigt; **aktueller Stand ist 1.5.2** (veröffentlicht; weiter 1.5 … 1.9, 1.10 …; kleine Nachlieferungen als 1.4.1, 1.4.2 …).
      Nächstes Release also 1.5.2 → 1.6 (oder 1.5.3) (`server/paths.py`, `web/static/app.js`,
      `?v=` in `web/index.html` + `web/tv.html`, `paket/START-HIER.txt`).
- [x] ~~Stufen-Schild auf den kleinen Listenkarten~~ – dort ausgeblendet.
- [x] ~~TV-Ansicht zeigt alle Karten sofort offen~~ – Spielerkarten jetzt erst
      nach dem Aufdecken (Joker-Moment ebenso). Falls doch anders gewünscht:
      `offen(c)` in `tv.js`.
- [ ] Geparkte Joker-Stile ggf. später weiterentwickeln (Ideen: Zerrissen noch
      feiner, Entladung als Alternative zu Blitz).

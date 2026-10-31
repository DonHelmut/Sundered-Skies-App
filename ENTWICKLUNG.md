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
- **GitHub Actions** (`.github/workflows/tests.yml`) lässt die Tests bei jedem
  Push auf Windows laufen; rotes ✗ auf GitHub = vor dem nächsten Pull ansehen.
- Server starten: `.venv\Scripts\python -m server.run` (LAN, QR-Code).
- **Musterseite** für alles Optische: `http://localhost:8000/static/_lab.html` –
  alle Joker-Stile (aktiv + geparkt), Kartenstufen, Talent-Wechsel-Demo.
- **Spieleransicht** braucht ein zweites Gerät oder die LAN-Adresse
  (`http://<laptop-ip>:8000`) – über `localhost` ist man immer Spielleiter.
- Achtung: Die **erste Aktion** nach einem Serverstart verwirft die gespeicherte
  Sitzung („Fortsetzen?"). Vor Tests mit echten Daten erst fortsetzen.

---

## Überblick 30.09.2026 – was heute alles passiert ist (1.4 → 1.5.6)

Für den anderen PC / Mitentwickler: ein Tag mit vielen kleinen Releases.
Details stehen in den einzelnen Abschnitten darunter.

- **Verteilen & Updaten:** Repo ist öffentlich (mit Fanprojekt-Hinweisen,
  `main` geschützt – nur Stefan pusht). Jede Version ist ein GitHub-Release mit
  `SunderedSkies-App.zip`. Im Paket liegt **`Aktualisieren.exe`**: holt das
  neueste Release, ersetzt die App, behält `data/`, mit Ladebalken; aktualisiert
  sich beim nächsten App-Start auch selbst (1.4.1–1.4.2, 1.5.1).
- **Stabilität:** kein stilles Wiederbeitreten fremder Geräte („Probe
  Schnell"-Gast), offene Tabs laden sich nach einem Update selbst neu,
  „☰ Mehr" nicht mehr abgeschnitten, eigene Rückfragen statt
  Browser-Dialogen (die der Browser sperren kann) (1.4.3–1.4.5).
- **Karten:** eigene gemalte Illustration (Himmelsinseln) als
  Standard-Rückseite; der SL kann ein eigenes Bild oder schlichtes Grün
  wählen (1.4.6, 1.4.8). **Neu in 1.5.5/1.5.6:** jeder Spieler wählt die
  Rückseite seiner Karten selbst – Standard, Profil (Charakterbild) oder
  eigenes Bild; ohne Wahl automatisch Profil (falls Bild da), sonst Standard.
- **TV:** deckt Spielerkarten erst nach dem Aufdecken auf und passt immer auf
  einen Bildschirm, nie Scrollen (1.4, 1.4.7).
- **Kämpfe vorbereiten** (1.5): Gegner aus der Bibliothek + Charaktere mit
  Startzone, Notiz; später mit einem Klick einspielen.
- **Mimi** (die Katze): rote Tigerkatze mit Umhang, läuft in 2D auf einer
  Bodenlinie, lässt sich versorgen (Futter/Trinken/Spielen/Streicheln),
  Schabernack dosiert und nur optisch – sie löst nie etwas aus (1.5.2, 1.5.3).
- **Handy-Adresse** kürzer: `http://pnp.local:8000` (1.5.4).

## Unveröffentlicht (31.10.2026): Genau mit zwei Erkennern

Kalle: „soll wirklich top sein", darf bis 4 GB groß sein. Modelle verglichen
(Tisch-Simulation aus 1.5.27, ideal geschnitten): Parakeet 27,7 %, **Canary
180M flash** (sherpa-onnx, `src_lang=de`, 200 MB) 18,6 %, Whisper large-v3
(das Modell hinter noScribe, 1,8 GB) 9× langsamer als Echtzeit → 36 h pro
Abend, raus. Canary 1B gibt es in sherpa-onnx (noch) nicht.

- Canary allein in der Kette: weniger Fehler, aber es **verschluckt das erste
  Wort nach einem Sprecherwechsel** – meist den Namen („[Korgo] stellt sich
  …"). Nach Sprechern zerschneiden half nicht.
- Darum `verschmelzen()`: beide hören jedes VAD-Stück. Canarys Text wird per
  Levenshtein an Parakeets Wörter (mit Zeiten) ausgerichtet: ersetzt → Canary
  (mit Parakeets Zeit), nur Parakeet → einfügen, nur Canary → behalten.
  Wird Parakeets Wort zu einem Namen, Canarys nicht → Parakeet.
- Ergebnis ganze Kette mit Namen: **Tisch 21,5 % → 15,3 %** (Namen 10 → 11/20),
  **sauber 14,1 % → 10,2 %** (11 → 13/20). Rechenzeit etwa doppelt
  (Container 0,45 → 0,78 × Tonlänge) – ThinkPad grob so lang wie der Abend.
- Live bleibt Parakeet allein (Canary hat keine Wort-Zeiten, live zählt Tempo).
- Canary ist **kein Pflichtmodell** (`PFLICHT`): Wer schon eingerichtet hat,
  behält live; im Panel erscheint „⬇ Genauer (200 MB)". Ohne Canary läuft
  genau wie in 1.5.27.

## 1.5.27 (31.10.2026): Mitschrift besser

Kalle: „Will dass es echt richtig gut ist." Gemessen an einem nachgebauten
Tisch: 4 Piper-Stimmen (SL nah, Spielerin am Tischende bei 12 % Pegel), Hall
je nach Abstand, 50-Hz-Brummen, Rauschen. Wortfehler genau-Durchgang:

| Stand | Wortfehler | Namen richtig |
|---|---|---|
| vorher (1.5.26) | 39 % | 3/20 |
| + Hochpass 100 Hz | 34 % | 3/20 |
| + nichts verschlucken (VAD statt Sprechertrennung) | 25 % | 3/20 |
| + Namenskorrektur | **21,5 %** | **10/20** |

- **Hochpass** (`Hochpass` in sprache.py, ffmpeg über PyAV, live und danach).
  Getestet und **verworfen**: Rauschunterdrückung (afftdn: 80 % Fehler!) und
  Lautstärke angleichen (speechnorm/dynaudnorm: schlechter). Nicht wieder
  einbauen ohne neue Messung. Browser-AGC bleibt an.
- **Nichts verschlucken:** Die Sprechertrennung (pyannote) übersah am Tisch
  22 % der Sprache, und nur ihre Abschnitte wurden erkannt. Jetzt sucht die
  Silero-VAD die Sprache (100 %), Parakeet erkennt je VAD-Stück, die
  Sprechertrennung verteilt nur noch die Wörter (wie live). Achtung: VAD
  bekommt genau 512 Samples je Aufruf – mit großen Brocken verschluckte sie
  den Anfang und hielt die Höchstlänge nicht ein.
- **Namenskorrektur** (`server/namen.py`): Namen aus App (Kampf, Figuren,
  Gegner-/Verbündeten-Vorlagen, Spieler, Kampfmarken der Aufnahme) + Liste
  „🏷 Namen" im Aufnahme-Panel. Kölner Phonetik + Levenshtein, gleicher
  erster Laut, nur großgeschriebene Wörter. Schutz: deutsches Wörterbuch
  (`server/woerter-de.txt.gz`, 59 000 häufigste Wörter aus wordfreq,
  CC BY-SA 4.0, 250 KB, steht in beiden .spec) – echte Wörter werden nie
  ersetzt, auch gebeugt nicht. Ohne Schutz: 26 Fehlalarme in 29 000 häufigen
  Wörtern („Mir"→„Mira", „Kreuzer"→„Krauzern"), mit: 0. Liste geht auch in
  den Prompt.
- **Englischer Unsinn** („How do you", „I love it"): Parakeet wählt die
  Sprache selbst und rutscht bei Rauschen ins Englische → Zeilen mit ≥ 60 %
  englischen Wörtern fliegen raus.
- **Sprecher:** „Leute: automatisch" nimmt die Zahl aus der App (verschiedene
  Spieler + SL; genau aus der Aufnahme, live als Obergrenze). **👥 Wer ist
  wer?** je Aufnahme: Sprecher mit ihren längsten Sätzen, Auswahl SL/Figuren
  oder frei → Prompt nennt „Korgo (Tim):" statt „S01:". Live: Sprecher in der
  Mitschrift antippen. Live und genau haben eigene Zuordnungen (andere
  Nummerierung), gespeichert in der Aufnahme-.json unter `sprecher`.
- `dialog()` kann jetzt eigenes Formular (`inhalt`/`lesen`), Enter im
  Textfeld = neue Zeile.
- Echt durchgespielt: Chromium mit Fake-Mikro (Tisch-Datei) → live, genau,
  Wer-ist-wer, Prompt. Sprechertrennung legt zwei Frauenstimmen weiter gern
  zusammen – dafür ist „Wer ist wer?" da. Echte Tischaufnahme bleibt der
  wichtigste Test.

## 1.5.27 (31.10.2026): Protokolle für Spieler (📜)

Kalle: „Mitspieler können das Protokoll lesen … eigenes Protokoll-Zeichen wie
die Einstellungen, zum Aufklappen". Gewählt: Variante A (📜 neben ⚙).
- **SL:** Panel „📜 Protokolle" (startet eingeklappt). „＋ Protokoll einfügen"
  → Titel + Text (was Claude aus dem „📝 Prompt" geschrieben hat), „📋 Aus
  Zwischenablage". Speichern = nur SL; „Freigeben"/„Zurückziehen" je Abend;
  „Ansehen" zeigt es so wie am Handy.
- **Handy:** 📜 erscheint neben dem ⚙ erst, wenn etwas freigegeben ist. Kleiner
  Punkt (fest, kein Pulsieren) bei neu Freigegebenem. Lesefenster mit allen
  Abenden, neuester oben aufgeklappt, Serifenschrift; Markdown von Claude
  (Überschriften, **fett**, Listen, Zitat) wird sicher umgesetzt (erst alles
  escapen).
- **Daten:** `data/protokolle.json` (dauerhaft wie Bibliotheken, in der
  Sicherung). Kein Undo-Ziel und zählt NICHT als „erste Aktion" – sonst kostete
  das Freigeben vor „Fortsetzen?" den gespeicherten Kampf.
- Im Zustand nur Titel/Stand; Text per `GET /api/protokoll/<id>` – Handys
  bekommen nur Freigegebenes (404 sonst), der Laptop alles.
- Code: `web/static/protokoll.js` (eigener Klick-Handler „prot-…"),
  `Game.protokoll_*` in `server/game.py`, Tests `tests/test_protokoll.py`.

## 1.5.26 (30.10.2026): Transkribierer in der App

Kalle: „eigentlich will ich den Transkribierer mit drin haben – auch wenn ich
aktualisiere". Der Extra-Download (1.5.25) ist damit wieder raus, der Ordner
`transkribierer/` gelöscht; alles steckt in `server/sprache.py`.
- **Modelle in `data/modelle`** (Aktualisieren behält `data`). Einmalig ca.
  540 MB per „⬇ Mitschrift einrichten" im Aufnahme-Panel, mit Balken.
- **Live ohne zweites Programm:** der Server liest die wachsende Aufnahme-Datei
  mit (`Mitlesen`, wie `tail -f`, PyAV dekodiert webm im Strom). Browser schickt
  dafür alle 3 s ein Stück (vorher 10 s). Kein zweiter Mikro-Zugriff,
  `sounddevice` entfällt. Startet automatisch mit jeder Aufnahme, wenn „Live
  mitschreiben" an ist (Standard; Einstellung in `aufnahmen/einstellungen.json`,
  dort auch „Leute am Tisch").
- **Genau transkribieren** pro Aufnahme im Hintergrund-Thread, Fortschritt im
  Panel (nur Balken/Text werden nachgeführt, kein render() alle 2,5 s). Jetzt
  auch mit **Parakeet** statt Whisper: 3 min Test-Ton in 67 s inkl. Laden
  (Faktor ~0,35; Whisper vorher ~0,8). Whisper-Modelle braucht es nicht mehr.
- sherpa-onnx gibt beim Rechnen das GIL frei (gemessen: Hauptthread hing max.
  0,04 s) → in Threads im Server-Prozess, die Handys merken nichts.
- Ende zu Ende getestet: Chromium mit `--use-file-for-fake-audio-capture`
  (Sprach-Datei als Mikro) → Live-Zeilen mit richtigen Zeiten und Sprechern →
  „Genau" → „📝 Prompt".
- Paket: `requirements.txt` + Specs um `sherpa_onnx`, `av`, `numpy`. App-Zip
  wächst von ~36 auf ~90 MB. Fremde Transkripte (noScribe) einlesen nur noch,
  wenn die Spracherkennung fehlt (Entwickler-.venv).
- Prompt: `POST /api/aufnahme/prompt-aus/{name}?quelle=genau|live`. Ein
  Live-Prompt legt kein `…-transkript.txt` mehr an (sonst galt es als genau).
- Noch ungetestet: Windows-Build (PyInstaller sammelt av/sherpa wie beim
  Transkribierer 1.5.25) und echter Tisch.

## 1.5.25 (30.10.2026): Live-Mitschrift

Kalle: „noch viel geiler, wenn das Gesprochene mehr oder weniger live
transkribiert wird". Der Transkribierer hat dafür einen Live-Modus
(`transkribierer/live.py`, Menü beim Doppelklick: 1 = live, 2 = Datei).
- Hört selbst am Mikro mit (`sounddevice`, parallel zur Browser-Aufnahme –
  Windows teilt das Mikro). Schickt jede Zeile per `POST /api/aufnahme/live` an
  die App (sucht sie auf den Ports aus `PORT_CANDIDATES`, nur localhost).
  Läuft keine Aufnahme → 409, Text nur in `transkribierer/live/…`.
- Server hängt Zeilen an `<aufnahme>-live.txt` (Zeit ab Aufnahmebeginn aus der
  Wanduhr des Transkribierers) und hält die letzten 60 für die Anzeige.
  SL-Panel zeigt während der Aufnahme die letzten 4 Zeilen klein und grau
  (alle 3 s abgefragt). Liste: „📝 Live-Text → Prompt" (sofort, ohne Durchgang).
- Pipeline je Sprechpause: Silero-VAD (≤ 12 s Stücke) → pyannote-Segmentierung
  im Stück (Sprecherwechsel ohne Pause; VAD allein klebte im Test Sprecher
  zusammen) → TitaNet-Abdruck, online gegen Mittelwerte je Sprecher
  (Ähnlichkeit ≥ 0,5; Test: gleiche Person 0,57–0,91, verschiedene ≤ 0,29) →
  **Parakeet TDT 0.6B v3** (int8, ~650 MB, Deutsch) mit Wort-Zeitstempeln: ein
  Aufruf je Stück, Wörter gehen an den, der gerade redet.
- Warum nicht Whisper live: rechnet jedes Stück auf 30 s aufgefüllt, je
  Sprecher ein Aufruf → im Test ~so langsam wie der Ton. Parakeet: Faktor
  ~0,15 (3 Threads), Text ~2 s nach Ende des Stücks, Qualität gleich gut.
  → Kandidat, auch den Durchgang danach (Stufe 2) schneller zu machen.
- Rechner zu langsam → älteste wartende Stücke werden übersprungen (live
  bleibt live), Hinweis in der Konsole; die Aufnahme ist ja vollständig.
- Test ohne Mikro: `python transkribieren.py --live-test DATEI --app http://127.0.0.1:PORT`.
- Echte Mikro-Nutzung unter Windows und Tischaufnahme noch ungetestet.

## 1.5.25 (30.10.2026): Transkribierer (Stufe 2, eigenes Werkzeug)

Kalle: Transkription als **Extra-Download, unabhängig von der App**, später
verschmelzbar; Ziel ein normaler 500-€-ThinkPad ohne NVIDIA. Ordner
`transkribierer/` mit eigener `requirements.txt`/.venv und eigener Spec
(`Transkribierer.spec`, Ordner-Variante, ~240 MB ohne Modelle).
- **Alles über sherpa-onnx (ONNX, CPU)**, kein PyTorch: Sprechertrennung
  (pyannote-Segmentierung 3.0 als ONNX + Stimmabdruck) und Whisper „turbo" int8.
  pyannote direkt bräuchte ein Hugging-Face-Konto mit Lizenz-Klick – die
  ONNX-Fassungen liegen frei auf GitHub (k2-fsa/sherpa-onnx Releases). Modelle
  (~1,1 GB) lädt das Programm beim ersten Start nach `modelle/` daneben.
- Ton lesen per PyAV (bringt ffmpeg mit) – die App speichert webm/Opus.
- Ablauf: erst Sprecher trennen, dann jeden Beitrag (≤ 28 s Stücke) einzeln
  durch Whisper. Ausgabe wie noScribe: `[hh:mm:ss] S00: …`, S00 = wer am meisten
  redet (meist SL). Passt direkt in „📝 Transkript → Prompt".
- Getestet mit erzeugtem deutschem Dialog (3 Piper-Stimmen, 2 männlich):
  - Stimmabdruck **TitaNet** trennte als einziges alle 3 richtig (WeSpeaker und
    3D-Speaker legten die Männer zusammen). Mit Personenzahl exakt, automatisch
    (Schwelle 0,7) eine Stimme zu viel.
  - Whisper verschluckte ohne Stille am Ende das letzte Wort jedes Beitrags →
    0,2 s Stille vorne, 1 s hinten.
  - Whisper „small" kaum schneller als „turbo", aber schlechter → nur turbo.
  - Tempo: Faktor 0,7–0,9 auf 4 Kernen (Container). ThinkPad grob 3–5 h für 4 h Ton.
- Echte Tischaufnahme (ein Mikro, Durcheinanderreden) noch ungetestet.
- Release: eigenes Zip `Transkribierer.zip` am GitHub-Release (Build am
  Windows-PC, Anleitung im Spec-Kopf). Danach in der App den noScribe-Knopf
  auf den Transkribierer umstellen.

## 1.5.24 (30.10.2026): Treffer-Meldung am Handy, alle Spieler heilen

- **Treffer-Meldung:** Trägt der SL einen Treffer gegen eine Spieler-Figur ein
  (`apply_hit`, auch über einen gemeldeten Spieler-Angriff), bekommt der
  Getroffene am Handy eine Meldung: Zeile 1 „🩸 Wolkenhai trifft dich – 1 Wunde"
  (bzw. angeschlagen / außer Gefecht), Zeile 2 Stand + Abzug auf Proben. Der
  Angreifer ist der Aktive (verdeckte Gegner nur mit Tarnnamen). Rote Kante,
  kurzes rotes Glimmen am Bildrand (nur opacity animiert), antippen schließt.
  Vorher erfuhr der Spieler es gar nicht (Kalle beim Testen).
- **Heilung** (`apply_heal`) meldet sich genauso, grüne Kante.
- **Alle Spieler heilen** (`heal_players`): Knopf im Kampf-Panel des SL,
  sichtbar nur wenn kein Gegner mehr steht und ein Spieler verletzt ist, dazu
  oben in der 🩹-Heilauswahl. Ganz heil (wach, 0 Wunden, nicht angeschlagen),
  auch pausierte; Verbündete/Gegner bleiben. Rückgängig mit ↶.
- Nachrichten haben dafür optional `art` („getroffen"/„geheilt"); Spieler gegen
  Spieler: der Getroffene bekommt nicht zusätzlich die „X trifft Y"-Meldung.

## 1.5.23 (30.10.2026): Spielabend aufnehmen → Protokoll-Prompt

Kalle: ganzen Abend aufnehmen, daraus 1–2 Seiten Story-Protokoll, Sprecher ohne
Ansagen, Kämpfe nur kurz. Vorgaben: Software gratis, lokal; nichts mit Handys
(gehen aus, Akku); höchstens ein Tischmikro kaufen. Recherche dazu im Projekt-
Ordner (`recherche/spielabend-protokoll.md`). Gebaut „Stufe 1":
- **Aufnahme im SL-Browser** (`web/static/aufnahme.js`, MediaRecorder, Opus
  48 kbit/s ≈ 90 MB für 4 h). Über `localhost` braucht der Browser kein HTTPS
  fürs Mikro. Alle 10 s ein Stück an `/api/aufnahme/stueck`, der Server hängt
  an `data/aufnahmen/<datum_zeit>.webm` an – Absturz kostet höchstens Sekunden.
  Stücke strikt nacheinander senden (Reihenfolge = gültige Datei). Bildschirm-
  Wachhalten (Wake Lock), Warnung beim Tab-Schließen, Mikro abgezogen → Ende.
  Server neu gestartet (409) → Browser fängt eine neue Datei an.
- **Kampfzeiten mitschreiben** (`server/aufnahme.py`, aus `broadcast_state`):
  Kampf = Runde > 0 UND noch ein Gegner steht. Nur auf Abräumen zu warten
  reichte nicht – sonst wäre nach dem letzten Treffer alles „Kampf". Gemerkt
  werden Beginn/Ende, Gegner („3× Ork"), Rundenzahl, Figur → Spielername.
  Bewusst KEIN Kampfverlauf (Kampf-Protokoll ist abgelehnt).
- **📌 Merken** (Kopfleiste und Panel): Zeitmarke ohne Nachfrage, kommt im
  Prompt als „besonders erwähnen".
- **Transkript → Prompt:** noScribe (github.com/kaixxx/noScribe, NICHT
  noscribe.ai – das ist ein gekaperter Bezahldienst) macht aus dem Ton ein
  HTML/TXT-Transkript. Das wählt der SL im Panel, der Server entfernt das HTML
  und baut den Prompt (Stil, Namen, Kampfzeiten, Marken, Transkript), speichert
  `…-transkript.txt`/`…-prompt.txt` daneben. Dialog: kopieren + claude.ai öffnen
  oder als Datei.
- Panel „🎙 Aufnahme & Protokoll" startet zugeklappt (Vorbereitungs-Panel).
- **Pegelbalken** während der Aufnahme + leiser Hinweis nach 90 s Stille (sonst
  merkt man erst nach dem Abend, dass das Laptop-Mikro oder ein stummes Headset
  lief). Breite per `transform`, nicht `width`. Mikro-Auswahl erscheint schon
  vor dem Start, sobald der Browser das Mikro einmal erlaubt hat.
  Kalle: nicht nerven, nur informieren, eher im Hintergrund → Kopfleiste als
  neutrale Pille mit Mini-Pegel; bei Stille wird nur der Punkt grau („kein Ton?"),
  im Panel eine graue Zeile. Keine Warnfarbe.
- Knopf „⬇ noScribe herunterladen" → noscribe.de (offizielle Seite, neueste
  Version; die GitHub-Releases haben keinen Windows-Installer).
- Offen: Stufe 2 = Transkription direkt in der App (faster-whisper + pyannote,
  mehrere GB) – erst, wenn noScribe nervt. Tondatei hat keine Längenangabe im
  Kopf (MediaRecorder); ffmpeg/noScribe stört das nicht, manche Player zeigen
  keine Gesamtdauer.

## 1.5.22 (29.10.2026): Offline-Hinweis entschlackt

Kalle: Handy-Ansicht soll clean und hochwertig wirken, der Offline-Hinweis war
ab 25 s eine Textwand (Rot-Titel, Warnkasten, Absätze, iPhone/Android-Pfade,
Adresse). Varianten auf `_lab_offline.html`, Kalle wählte **B**:
- Erste 25 s: Ring + „Verbindung kurz weg / Verbinde neu …" + ein Satz + Knopf.
- Ab 25 s (oder sofort bei erkanntem Mobilfunk) von selbst zwei Prüfpunkte:
  ① Mobile Daten aus ② Handy-IP beginnt mit … (Mobilfunk erkannt → Punkt 1
  betont, Titel „Handy ist auf Mobilfunk").
- Kein Rot, kein Warnkasten, keine Sekunden/Versuchszahl, keine Adresse mehr.
- innerHTML nur bei echter Änderung neu setzen – sonst springt der Ring bei
  jedem Verbindungsversuch zurück.
- Nicht gewählt: A (Tipps erst auf „Hilfe"), C (erst nur Leiste oben).

## 1.5.21 (29.10.2026): Hinweis Adressbereich

Kalle: Info für Spieler, wenn ihre IP nicht im Adressbereich des SL-Laptops liegt.
Erkennen kann die App das am Handy nicht (falsches Netz = Seite lädt gar nicht,
eigene IP liest der Browser nicht aus). Darum nennt sie den Bereich überall dort,
wo Spieler oder SL nachsehen:
- `adressBereich(ip)` in app.js: erste drei Zahlen („192.168.178."), /24 angenommen.
- SL „Beitritt": Zeile unter der Adresse, wie man am Handy die IP findet (hinter ⓘ).
- Einladungstext + QR-Bild: „Geht nicht? Handy-IP muss mit … anfangen".
- Handy-Offline-Hinweis (ab 25 s): „Richtiges WLAN?" mit Bereich + Weg zur IP.
- START-HIER.txt Punkt 1: Schnelltest (Fritzbox-Gast = 192.168.179.x).

## 1.5.20 (25.10.2026): Karten am Handy flüssiger

Kalle: Karten am Handy wirken „ganz leicht laggy". Gemessen (Chromium, Handy-
Größe, CPU 4× gedrosselt, Leerlauf 3 s):
- **Ursache:** pulsierende `box-shadow`-Animationen. Ein animierter Schatten
  ist nicht komponiert – der Browser malt das Element samt Inhalt in JEDEM
  Frame neu. Schlimmster Fall das Einladungs-Glimmen der verdeckten Großkarte
  (`tapInvite`): ~2,3 s Mal-Arbeit in 3 s. Dazu `jokerRow` an der Zonen-Scheibe
  dessen, der dran ist (läuft praktisch den ganzen Kampf) und an der Joker-Zeile,
  `jokerGlow` auf der Joker-Karte, `awaitPulse`/`awaitBig` auf Rückseiten.
- **Fix:** Schein fest gemalt auf eigener Ebene (`.flip-back::after`,
  `.flip-inner::before`, `.combatant.joker-holder::after`,
  `.zone-token.active::before`), animiert wird nur `opacity` (Keyframe
  `glimmen`). Danach Leerlauf ≈ 0 ms Malen. Optik praktisch gleich.
- TV-Kacheln unverändert (`overflow: hidden` schneidet den Schein ab, TV wird
  nicht verbessert).
- Bleibt: liegt ein Joker auf dem Tisch, laufen seine SVG-(SMIL-)Animationen
  weiter und kosten am Handy etwas – gewollte Show.
- Regel für später: **kein animierter `box-shadow`** auf Karten/Zeilen;
  Leuchten = fester Schatten auf Pseudo-Ebene + `opacity`-Animation.

## 1.5.19 (25.10.2026): Handy aufgeräumt, Runde 2

- Kalle wählte aus neuen Aufräum-Ideen (Handy 1–5, SL 7):
  - **Ein Dran-Hinweis:** nur noch die Leiste oben; kommt man als Nächstes,
    steht dort hervorgehoben „⏳ Gleich bist du dran". Kasten „Gleich bist du
    dran" und Zeile „Warte auf Freigabe" unter der Karte sind weg (bleibt nur
    die Uhr, wenn man dran ist).
  - **Eigene Zeile in der Reihenfolge** ohne „Du", „WC", Bennies und Wunden
    (steht alles im Kopf), `schlank` in `combatantRow`.
  - **Reihenfolge am Handy einzeilig** (CSS `body.player .order …`).
  - **Leerer Bogen = eine Zeile** „📜 Charakterbogen ausfüllen ✎".
  - **Bereiche selbst sortieren:** ⚙ → „Reihenfolge der Bereiche" mit ▲▼,
    gemerkt pro Handy (`localStorage.handyBereiche`). Standard: Reihenfolge,
    Zonen, Bogen, Nachrichten. Ziehen wie beim SL geht am Handy nicht (HTML5-
    Drag kennt keinen Touch), darum Pfeile.
  - **⚙ am Handy:** Ton/Vibration, Kartenrückseite und „Spiel verlassen"
    (`spielerMenueHtml`, render() füllt `#spieler-menue`). Das Menü schließt bei
    Klicks darin nicht mehr (Ziel nach Neuzeichnen nicht mehr im Dokument).
  - **SL: Nachricht/Bild/Bennies** startet zugeklappt, Pool im Titel; einmalig
    zugeklappt auch bei gemerktem Zustand (`collapsed._nachrichtZu`).

## 1.5.18 (23.10.2026): Netzwerk-Hilfe in EINEM Skript

- Kalle: vier Skripte (Firewall/WLAN je hin und zurück) sind zu viel. Jetzt
  nur noch `Netzwerk-einrichten.bat` (Firewall + WLAN) und
  `Netzwerk-rueckgaengig.bat`; die ps1 hat dafür die Aktionen `Einrichten`
  und `Zurueck` (jeder Teil einzeln abgesichert). Die Einzel-Aktionen bleiben
  für den Knopf in der App (nur Firewall) und `werkzeuge/netzwerk-test.ps1`.
- Die alten vier .bat im Ordner Netzwerk-Hilfe verschwinden beim Update von
  selbst (der Updater ersetzt Ordner komplett). Die alten .bat im Hauptordner
  und die `*.neu`-Reste räumt die App beim ersten Start nach dem Update weg
  (`updater_nachziehen`) – vorher liegen sie noch da, das ist normal.

## 1.5.17 (23.10.2026): Netzwerk-Hilfe mit Rückgängig

- Anlass: Kalle fragte, ob die Skripte wirklich helfen – die App läuft oft auf
  dem Laptop eines Kumpels, dessen Einstellungen danach wieder stimmen müssen.
- **Befund:** `WLAN-Stromsparen-aus.bat` war kaputt (PowerShell-Befehl ohne
  Anführungszeichen → Syntaxfehler, tat nie etwas). `Firewall-freigeben.bat`
  half nicht, wenn Windows die App still sperrt: Nach „Abbrechen" im Fenster
  „Zugriff zulassen?" legt Windows Blockier-Regeln für die .exe an (am Jonsbo
  zwei, Profil Öffentlich), und Blockieren schlägt Freigeben.
- **Neu:** Ordner `paket/Netzwerk-Hilfe/` mit vier .bat (holen sich die
  Adminrechte selbst, Doppelklick reicht) und `netzwerk-hilfe.ps1`, das die
  Arbeit macht:
  - Firewall: Port-Regel + Programm-Regel für die .exe (dann fragt Windows
    nicht mehr und kann keine neue Sperre anlegen) – nur wenn noch keine
    passende Regel da ist; vorhandene bleiben samt ID stehen, die Sicherung
    merkt sich die IDs der neu angelegten. Blockier-Regeln der App
    **ausschalten** (nicht löschen), „alle eingehenden blockieren" aufheben.
    Warnt bei Fremd-Firewall und Firmen-Richtlinie.
  - WLAN: Haken „Computer kann das Gerät ausschalten" weg (Ausweg über
    Registry `PnPCapabilities=24`, wenn das Cmdlet scheitert – am Jonsbo bei
    „WLAN 2") und Energieplan → Drahtlosadapter → Energiesparmodus auf
    Höchstleistung (Netz + Akku).
  - **Rückgängig:** Vorher-Zustand liegt in `%ProgramData%\Sundered Skies
    Initiative\*.json` (nicht im App-Ordner – sonst weg beim frischen
    Entpacken). Mehrfaches Freigeben überschreibt die erste Sicherung nicht.
    `…-rueckgaengig.bat` stellt exakt her und löscht die Sicherung.
  - Mit nachgebauten Windows-Befehlen unter pwsh (Linux) durchgespielt:
    Hin und zurück ergibt genau den Ausgangszustand. **Am Jonsbo echt
    getestet (23.10.2026)** mit `werkzeuge/netzwerk-test.ps1` (in Admin-
    PowerShell): 2 Blockier-Regeln aus und wieder an, .exe-Regel angelegt und
    entfernt, WLAN über Registry-Ausweg, Ergebnis „GLEICH".
- Der Knopf „Firewall freigeben" in der App nutzt jetzt dasselbe Skript
  (fällt auf netsh zurück, wenn es fehlt).
- **App hält den Laptop wach**, solange sie läuft (`winnet.wach_halten`,
  `SetThreadExecutionState`) – ändert keine Einstellung. Deckel zu = schläft.
- Alte Skripte im Hauptordner räumt der Updater weg (`AUSGEMUSTERT`).
- Test `tests/test_netzwerk_hilfe.py`: Ports/Regelname wie in der App, nur
  ASCII, CRLF, jede .bat ruft eine gültige Aktion.

## 1.5.17 (23.10.2026): SL-Treffer in einem Tipp

Kalle: „Drücke meistens Treffer, wähle den Spieler – dann kommt halt
angeschlagen, nicht wie viele Treffer." Die Stärke stand oben in der Zielwahl,
vorgewählt „Erfolg"; wer gleich das Ziel antippte, bekam nur 😵.
Vorschläge A/B/C in `web/static/_lab_treffer.html`, Kalle wählte **B**:
- 🎯 Treffer: eine Zeile pro Ziel mit 😵 / +1 / +2 / +3 daneben, ein Tipp
  (`trefferWahlHtml`, `trefferAuf(id, shift, stufe)`). War das Ziel schon
  angeschlagen, heißt der erste Knopf „1 🩸" (SWADE). Shift lässt offen.
  Schadensfeld (Kampfhilfe) jetzt über 🧮 pro Zeile. Board-Tipp nimmt weiter
  die per Taste 0–3 vorgewählte Stärke.
- 🩹 Heilung: dieselbe Liste (`App.trefferWahl = "heil"`), auch Ausgeschaltete
  und der Aktive; Knopf sagt, was passiert (wach / −1 🩸 / 😵 weg). `heilAuf`.
- Leiste: vorn nur Treffer + Heilung, 😵 ☠ 🔄 ⚙ hinter ⋯ (`App.leisteMehr`).
  „💥 selbst getroffen" ist aus der Leiste raus (Taste T geht weiter).
- Nicht gewählt: A (Ziel, dann großes „wie schlimm?"), C (Stärke klappt am Chip auf).

## Unveröffentlicht (nach 1.5.15, 22.10.2026): Handy-Design 1B, 2B, 3B, 4B

- Kalle hat aus zehn Design-Vorschlägen gewählt; Varianten lagen in
  `web/static/_lab_design.html` (bleibt als Musterseite). Gebaut, nur Handy:
  - **Zustand unter dem Namen** (`kopfZustand` in tisch.js, ersetzt
    `bigStatusDisplay`): „😵 Angeschlagen ●○○ −1" als schmale Zeile statt zwei
    großer farbiger Kästen unter der Karte.
  - **Angeschlagen ohne Erklär-Kasten:** die Frage „Willenskraft oder
    Konstitution geschafft?" steht als Zeile über den Daumen-Knöpfen
    („✓ Geschafft" / „🪙 Benny"), `daumenKnopf` → `.mit-frage`.
  - **Goldrand um den Bildschirm**, solange man dran ist (`.dran-rahmen`, fest,
    keine Animation, z-index über Daumen-Leiste und Zielwahl, unter Nachrichten).
  - **Bennies als Münzen** neben dem Zustand (`muenzenKopf`); Antippen →
    Rückfrage → Anfrage „🪙 Benny ausgeben" an den SL (wie über „Anfragen").
    Ohne Anfragen nur Anzeige. Erst rechts neben „Runde" probiert: da brach der
    Name buchstabenweise um.
- Nicht gewählt: Zielwahl-Kacheln, leere Zonen einklappen, weniger Chips,
  aktive Zeile fetter, Toast an die Leiste, Gegner in Zonen stapeln.

## Unveröffentlicht (nach 1.5.14, 15.10.2026): Treffer/KO für alle

Kalle: „Wenn ein Spieler jemanden ausschaltet oder trifft, kriegen die anderen
keine Nachricht." War nie drin (seit 1.1 ging die Meldung nur an den Angreifer).
`_do_resolve_attack` schickt jetzt bei Treffer/KO zusätzlich eine kurze
Meldung („☠ Tessa schaltet Ork aus") an alle übrigen Spieler – Ziel ist die
Liste der anderen Spieler-IDs, der Angreifer bekommt nicht doppelt. Daneben /
„steckt es weg" bleibt beim Angreifer. Am Handy als Kampf-Toast, nicht im
SL-Nachrichtenfeld. Test: `test_treffer_und_ko_sehen_auch_die_anderen`.

## 1.5.14 (15.10.2026): SL-Nachrichten + Flüstern

Kalle: „Nachrichten vom SL sehen aus wie ein Kampf-Log … und wenn der SL einem
einzelnen Spieler was schickt, sollen die anderen nichts mitbekommen."

- Handy-Feld „Nachrichten vom Spielleiter" zeigt nur noch, was der SL schreibt.
  Angriffsergebnisse (`sender: "kampf"`) und Mimis Miau bleiben reine Toasts.
- **Flüstern serverseitig:** `Game.nachrichten_fuer(player_id)` – jedes Handy
  bekommt nur „an alle" + die an sich selbst. `broadcast_state` baut dafür pro
  Handy eine flache Kopie der Spieler-Fassung mit eigener Nachrichtenliste
  (Rest geteilt). TV und noch nicht beigetretene Handys sehen nur „an alle".
  Vorher ging alles an alle Handys und wurde nur im Browser ausgeblendet.
- Optik: Geflüstertes violett umrandet („🤫 Nur an dich" / „🤫 Der Spielleiter
  flüstert dir zu"), beim SL „🤫 nur an Tessa" im Verlauf, Empfänger-Liste mit 🤫.
- **Flüstern an mehrere** (Kalle: „Kann man auch an 2 flüstern?"): Empfänger
  „🤫 Mehrere flüstern …" zeigt Antipp-Knöpfe je Spieler. `target` ist dann eine
  Liste von Spieler-IDs (`_nachricht_an` in game.py); Bennies gehen nur an die
  Gewählten. Am Handy: „🤫 Nur an dich und Korgo". Die Empfänger-Wahl beim SL
  merkt sich jetzt `App.msgZiel` – sprang vorher bei jedem Update auf „Alle".
- Tests: `test_gefluestertes_nur_beim_empfaenger`, `test_fluestern_an_mehrere`,
  `test_broadcast_fluestern_nur_an_ziel_handy`.

## Unveröffentlicht (nach 1.5.12, 15.10.2026): Bild-Upload vom Handy

Kalle: „Bild hochladen vom Handy – es passiert einfach nichts." Ursache: die
`<input type=file>` stehen in der Ansicht, die `render()` bei jedem
Server-Update neu baut. Solange am Handy Galerie/Kamera offen ist, liegt die
Seite im Hintergrund; kommt in der Zeit ein Update (anderer Spieler, Leitung
kurz weg), ist das angetippte Feld schon ersetzt und sein `change` erreicht den
Handler an `document` nicht mehr – kein Upload, keine Meldung. Nachgestellt mit
Playwright (Handy-Ansicht, zweiter Spieler tritt bei, während die Auswahl offen ist).

- Fix (`ereignisse.js`, „Dateiauswahl über EIN festes Feld"): ein Klick auf ein
  Datei-Feld öffnet stattdessen ein festes, unsichtbares Feld direkt an
  `<body>`, das `data-act`/`data-id`/... übernimmt. Gilt für alle Upload-Stellen
  (Spieler: Charakterbild, Kartenrückseite; SL: Nachrichtenbild, Vorlagen,
  Rückseite, Sicherung laden). Dasselbe Bild zweimal wählen geht weiterhin.
- Neue Datei-Felder brauchen nichts Besonderes: `data-act` setzen, im
  change-Handler behandeln – fertig.

## 1.5.12 (15.10.2026): Spieltest Optik Handy + SL

Kalle: „wie es für Spieler und SL aussieht, erst Vorschläge". Kampf mit SL,
4 Handys und TV durchgespielt, 11 Vorschläge, Kalle wählte (TV vorerst egal):

- **Karte aufdecken bei getrenntem Handy** (`Game._offline_aufdecken`): ist
  eine Spielerfigur dran, deren Handy nicht verbunden ist (oder die gar keins
  hat), deckt der Server ihre Karte auf - beim Drankommen und wenn das Handy
  während des Zugs wegbricht. Sonst blieb sie den ganzen Zug und danach
  verdeckt. Mit Handy deckt der Spieler weiter selbst auf (Kalle: „nur wenn
  Spieler disconnect"). Tests in test_game.py.
- **„Du bist dran!" nur noch einmal**: der große Balken unter dem Namen ist
  weg, die mitlaufende Leiste oben wird dafür golden. Vor der Freigabe stand am
  eigenen Handy „Vela ist dran" - jetzt „Du bist dran, sobald der Spielleiter
  freigibt".
- **Zielwahl am Handy** mit Bild und ausgeschriebenem Zustand („angeschlagen",
  „1 Wunde", sonst „unverletzt"); verdeckte Gegner bleiben unscharf.
- **Kampfzonen am Handy kompakter** (unter 520 px): schmale Beschriftung,
  kleinere Figuren, zwei pro Zeile statt einer - Board etwa halb so hoch.
- **Lange Namen**: Beitritts-Kacheln trennten „Windreiteri|n" (jetzt kleineres
  Bild, ganze Wörter); im Handy-Kopf bleiben Runde und „Verlassen" rechts, der
  Name bricht selbst um.
- **Erholen-Knöpfe gleich groß** („Erholt" und „Benny ausgeben").
- **SL-Hinweis** (`toast`) erscheint über der unteren Leiste statt auf ihr.

## 1.5.11 (14.10.2026): Stabilitätstest Runde 2

Kalle: „weiter testen, Stabilität und Bugs". Diesmal Verbindungen, viele Handys,
Speichern/Laden, Zufalls-Aktionen (Fuzzing aller SL-Aktionen: Deck und
Spielstand bleiben sauber). Behoben:

- **Ein hängendes Handy fror den ganzen Tisch ein** (`Hub.broadcast_state`):
  Spielstand ging nacheinander und ohne Frist raus. Nimmt ein Handy nichts mehr
  an (WLAN weg, Leitung noch nicht tot), läuft der Sendepuffer voll und JEDES
  Senden hing daran – im Test über 2 Minuten Stillstand, SL und andere Handys
  flogen raus. Jetzt an alle gleichzeitig mit 3 s Frist (`SENDE_FRIST`); wer
  nicht annimmt, wird aufgegeben und verbindet sich selbst neu.
- **Handy zeigte „Getrennt", obwohl verbunden** (verbindung.js, tv.js): nach dem
  Aufwachen kappt der Heartbeat die alte Leitung, Fokus baut sofort eine neue.
  Das späte `onclose` der alten stellte die NEUE auf getrennt: Hinweis blieb
  stehen, Heartbeat aus, beim SL „offline". Handler prüfen jetzt, ob sie noch
  die aktuelle Leitung sind (`leitungVerloren`); der Heartbeat wartet nicht mehr
  auf `onclose`.
- **Server: Spieler „offline" nach Neuverbinden**: das Ende der alten Leitung
  setzte den Spieler offline, obwohl die neue schon lief; die Stille-Wache ließ
  den Status alle 5 s kippen. Jetzt zählt pro Spieler die frischeste Leitung.
- **Strom/Akku weg beim Speichern → alle Charaktere weg**: roster.json voller
  Nullbytes, App startete leer, erste Änderung überschrieb auch die .bak.
  Jetzt `fsync` vor dem Tausch, Laden fällt auf die .bak zurück
  (`_lade_liste`, kaputte Datei bleibt als `.kaputt`), und nur eine lesbare
  Datei wird zur .bak.
- **Unlesbare session.json**: „Fortsetzen" tat nichts, die Frage blieb stehen,
  Spieleraktionen zählten nicht, gespeichert wurde nichts. Jetzt endet die Frage.
- **Handyfotos zu groß** (aktionen.js `bildFuersHochladen`): 4–20 MB pro Foto,
  über 8 MB lehnte der Server ab, darunter lud jedes Handy am Tisch das Bild in
  voller Größe. Jetzt vor dem Hochladen auf max. 1600 px (JPEG 0,85, PNG bleibt
  PNG wegen Transparenz; GIF und kleine Dateien unverändert). Test: 11,4 MB →
  0,9 MB.
- **Import ohne Charakter-IDs** (von Hand gebaute Sicherung): jeder folgende
  Beitritt scheiterte mit KeyError. `_gepruefte_liste` vergibt fehlende/doppelte IDs.
- Geprüft ohne Befund: lange Sitzung (400 Runden: Speicher, Sitzungsdatei,
  Tempo bleiben gleich), Updater (abgebrochener Download fasst nichts an).
- Tests: tests/test_stabilitaet.py (ohne Fix rot).

## 1.5.11 (14.10.2026): Kein „Gast"/„Nur zuschauen" mehr

- Anlass: Wer am Handy „👁 Nur zuschauen" tippte, wurde trotzdem als Figur
  „Gast" angelegt und stand in Reihenfolge und Zonen (Kalle: „Gast macht ja
  überall mit??").
- Beitritt nur noch mit Charakter: aus der Liste, „Weiter als …" oder „Neuen
  Charakter erstellen". Knopf entfernt (`renderJoin`), `doJoin` sendet ohne
  Charakter nichts, `add_guest_combatant` gelöscht.
- Server lehnt `join` ohne `characterId` ab (`joinError`, `grund:
  "ohne-charakter"`; beim stillen Wiederbeitreten ohne Meldung → Handy zeigt
  die Charakterwahl). Ausnahme `hat_eigene_figur`: Gerät hat schon eine Figur
  im Kampf (Gast aus alter Sitzung) → bekommt sie zurück, keine zweite.
- Zuschauen ohne Figur: TV-Ansicht (unverändert).

## 1.5.10 (14.10.2026): Reihenfolge schneidet nichts mehr ab

- SL-Reihenfolge (v. a. zweispaltig): Abzeichen hinter dem Namen wurden rechts
  abgeschnitten („verdeckt", „Gruppenkarte", Bennies). Jetzt Name oben,
  Abzeichen darunter (die Kartenminiatur macht die Zeile ohnehin so hoch).
  Wird es trotzdem eng, schrumpfen erst Zone und „↓ danach", dann bricht die
  Abzeichen-Zeile um – abgeschnitten wird nichts mehr.
- „Verdeckt" für den SL kein Abzeichen mehr, sondern 🫥 vorn am Namen plus
  gestrichelter Unterstrich (auch an der Gruppenkarten-Zeile, wenn ein
  Mitglied verdeckt ist).

## 1.5.9 (14.10.2026): Spieltest – Zugfolge repariert

Kalle: „testen und szenarien". Kampf im Browser durchgespielt (SL + 4 Handys:
Beitritt, neuer Charakter am Handy, Aufdecken, Angriffe, Abwarten/Eingreifen,
Neuladen, Nachzügler mitten in der Runde, Joker, Bögen, Spickzettel, TV,
Laptop-Neustart mit Fortsetzen/Verwerfen) plus Zufalls-Stresstest (400 Kämpfe,
Deck immer 54 verschiedene Karten). Behoben:

- **Zugfolge** (`_kann_dran_sein`/`_advance_active` in game.py): der Zug ging
  stumpf an den Nächsten in der Liste. Folgen: nach einem **Eingreifen** bekam
  ein schon fertiger Gegner einen zweiten Zug; **K.O.**, **pausierte**,
  abwartende und kartenlose (Nachzügler) Figuren wurden „dran"; am Rundenende
  stand noch ein Pausierter als aktiv da, also teilte die Leertaste nicht aus.
  Jetzt überspringt der Server dieselben Figuren wie die Anzeige „danach: …"
  (`naechsterAkteur` in app.js, dort zusätzlich abwartende/kartenlose).
  „Freigeben" nach dem Rundenende fängt nicht wieder beim Ersten an.
- K.O.-Figuren konnten abwarten (`_do_hold` prüfte `c["out"]`, das gibt es nicht).
- **Neuer Charakter am Handy** kannte seine eigene ID nicht: nach Laptop-Neustart
  + „Verwerfen" kam der Spieler als namensgleicher Gast ohne Bogen zurück. Das
  Handy merkt sich die ID jetzt (spieler.js).
- Bogen-Ansicht: „Korgo gespielt von Korgo" → nur, wenn der Spielername anders ist.
- Tests: `test_nach_eingreifen_…`, `test_zug_ueberspringt_…` u. a. in test_game.py.

## Unveröffentlicht (nach 1.5.7, 05.10.2026): Bögen für alle, Gegner-Spielwerte

- Kalle: SL soll die Charakterbögen sehen, **die Mitspieler auch**. Nur lesen –
  eintragen bleibt Sache des Spielers. Zu öffnen über: Token-Popup („📜
  Charakterbogen"), SL-Rechtsklick („📜 Bogen"), Bibliothek → Charaktere („📜",
  auch außerhalb des Kampfs) und am Handy unter „Mein Charakter" → Mitspieler.
  Blatt `bogenAnsichtHtml()` in bogen.js (`App.bogenAnsicht = {id, quelle}`);
  Lese-Ansicht `bogenLesenHtml()` teilt sich der eigene Bogen.
- **Gegner-Spickzettel**: Feld „📜 Spielwerte" (Freitext, max. 3000 Zeichen) in
  Gegner-/Verbündeten-Vorlagen und im Figur-Editor (`kampfwerteFelder`). Freitext,
  damit man den Werteblock aus dem Regelbuch hineinkopieren kann; „Wort:" am
  Zeilenanfang wird fett, „•/-/*" wird Aufzählung; „Attribute:" wird ein Raster
  aus fünf Kacheln, „Fertigkeiten:" eine Liste Name/Würfel, „Titel:" allein eine
  Überschrift (Kalle: Attribute als Fließtext zu unaufgeräumt). Reist über `_kampfwerte` mit
  (Vorlage → Kampf → vorbereiteter Kampf); vorbereitete Kämpfe holen die
  Spielwerte beim Starten frisch aus der Bibliothek (`vorlage`).
- Gegner-Spielwerte bekommen die Handys NICHT (`_fuer_spieler` streicht sie),
  die von Verbündeten schon.
- Gemerkt, nicht gebaut: **Sprachsteuerung** für den SL (Kalle überlegt noch).

## 1.5.7 (03.10.2026): app.js aufgeteilt, Tests auf GitHub

- **app.js (5 300 Zeilen) in 11 Dateien geschnitten**, Inhalt unverändert –
  nur an den vorhandenen Abschnitts-Überschriften getrennt: `app.js` (Kern) →
  `verbindung.js` → `dialoge.js` → `tisch.js` → `render.js` → `sl.js` →
  `bogen.js` → `spieler.js` → `ereignisse.js` → `aktionen.js` → `start.js`.
  Warum: schneller finden, weniger Git-Konflikte zwischen den PCs.
- Klassische Scripts, gemeinsamer globaler Bereich (kein Build, keine Module –
  sonst müsste jede der ~hunderten Funktionen exportiert werden). Einzige
  Falle: Code, der beim LADEN läuft (nicht in einer Funktion), darf nur auf
  frühere Dateien zugreifen – Funktions-Hoisting gilt nur innerhalb einer Datei.
  Geprüft per Skript (keine Ladezeit-Zugriffe nach vorn) und im Browser:
  SL + Spieler beitreten, Runde, Aufdecken, Treffer, Rechtsklick-Menü, TV –
  keine Fehler in der Konsole.
- `ASSET_VERSION` bleibt in `app.js`. Beim Release `?v=` jetzt in allen
  Script-Tags von `index.html` hochzählen.
- **GitHub Actions** (`.github/workflows/tests.yml`): pytest bei jedem Push.

## 1.5.6 (30.09.2026): Ohne Wahl: Profilbild, sonst Inseln

- Stefan: Die Porträt-Rückseite war gut, wenn der Spieler schon ein
  Charakterbild hat – sonst die Inseln (Variante „D" der Musterseite
  (lokale Vorschau, nicht im Git): eigene Zeichnung + Kompass).
- `rueckseite` jetzt: None = **automatisch** (Charakterbild, falls vorhanden,
  sonst Tisch-Rückseite – wie vor 1.5.5, auch für Gegner), `"standard"` =
  bewusst die Tisch-Rückseite, `"profil"`, `"/uploads/…"`. Die Auswahl am
  Handy markiert, was gerade tatsächlich gilt.
- Unterer Verlauf der Bild-Rückseite 0.75 → 0.6 (genau wie Variante D).

## 1.5.5 (30.09.2026): Spieler wählen ihre Kartenrückseite

- Stefan: Jeder Spieler soll selbst wählen, was hinten auf SEINEN Karten
  ist: die Standard-Rückseite des Tisches (Inseln), sein Profil
  (Charakterbild) oder ein eigenes Bild.
- Am Handy unter dem Ton-Schalter: „🂠 Kartenrückseite: …" – aufgeklappt drei
  kleine Karten zum Antippen. Profil ohne Charakterbild bzw. Eigenes ohne Bild
  öffnen direkt die Bildauswahl.
- Feld `rueckseite` an Figur und Charakter (None / `"profil"` /
  `"/uploads/…"`), gemerkt am Charakter (kommt beim nächsten Abend wieder,
  übersteht Bearbeiten im Roster), Aktion `set_figur_rueckseite` – Spieler
  nur für die eigene Figur, kein Rückgängig-Schritt (reine Optik). Das eigene
  Bild zählt beim Aufräumen als benutzt und kommt mit in die Sicherung.
- **Verhaltensänderung (in 1.5.6 wieder zurückgenommen):** Früher bekam jede Figur mit Charakterbild
  automatisch das Porträt als Rückseite. Jetzt ist Standard überall die
  Tisch-Rückseite; das Porträt nur, wer „Profil" wählt. (Gegner zeigen damit
  auch keine Porträt-Rückseite mehr - verdeckte Gegner verraten sich so nicht.)
- Joker bleibt geheim: alle Karten EINER Figur haben dieselbe Rückseite.
- Testen ohne echten Spielstand: Server mit Umgebungsvariable `SWI_DATA_DIR`
  auf einen leeren Ordner starten (hier lokal als Startkonfiguration
  `sundered-skies-probe8766` in `.claude/launch.json`, nicht im Git).

## 1.5.4 (30.09.2026): Kurzer Handy-Name pnp.local

- Stefan: `pen-and-paper.local` war am Handy zu lang zum Tippen. Der
  mDNS-Name ist jetzt `pnp` (`HOSTNAME` in `server/paths.py`), die Adresse
  also `http://pnp.local:8000/`. Getestet: Windows löst `pnp.local` auf,
  `/api/info` antwortet. Android kann `.local` je nach Version nicht – dort
  bleiben IP-Adresse und QR-Code.
- Nebenbei: der Start-Hinweis im Konsolenfenster nannte immer Port 8000,
  auch wenn die App auf einen Ausweich-Port gewichen war.

## 1.5.3 (30.09.2026): Mimi wackelt Knöpfe nur an

- Stefan: Mimi darf nicht wirklich z. B. neu austeilen. Tat sie nie (kein
  Klick, nichts an den Server – getestet: 0 Klicks, Spiel unverändert), aber
  das „Drücken" (kleiner + Goldrahmen) sah echt aus. Jetzt nur noch ein
  Anwackeln (`miAnwackeln`) und „*stups*"/„hihi" statt „*klick*".

## 1.5.2 (30.09.2026): Mimi als rote Tigerkatze, versorgen, dosierter Schabernack

- **Neues Aussehen** (`catSVG(art)` in mimi.js; mehrere Runden mit Stefan):
  schlanke, helle **Tigerkatze** (gestreift) mit rotem Umhang (glatt, mit
  Goldborte und Spange) – frech, verspielt, clever, cool. Athletischer Körper
  (flacher Rücken, hochgezogene Taille – die Ellipse wirkte „fett"), große
  spitze Ohren, scharfe Mandelaugen mit Schlitzpupille, verschmitztes
  Grinsen, Schnurrhaare nach hinten zur Backe, alle vier Beine gleich geformt
  mit Pfote/Zehen, geringelter Schwanz. Verworfen: runde Kulleraugen
  („drogenabhängig"), Bengal-Rosetten (gezeichnet nicht schön), zerfetzter
  Umhang („Obdachlose"), Stirnstreifen, Strich hinter dem Auge.
- Fellfarbe: nur noch **Rote Tigerkatze** (Stefan wählte sie aus vier
  Varianten; `MIMI_FELLE` bleibt als Palette, weitere ließen sich ergänzen –
  die Auswahl im ⚙-Menü ist wieder raus). Körper danach „ein weeenig runder"
  (Taille weniger hochgezogen). Musterseite `_lab_mimi.html` zeigt den Stand.
- **2D statt Hüpfen in die Tiefe** (Stefan): Mimi lebt auf einer Bodenlinie
  (`BODEN()` = unten), läuft mit Laufbewegung (`laufen`), bleibt immer gleich
  groß (Sprung-Animation ohne Strecken/Stauchen). Nach oben nur, um mit einem
  Menüpunkt/einer Karte zu spielen – `fertig()` springt danach zurück auf den
  Boden. Wollknäuel rollt auf der Bodenlinie ins Bild, Mimi rennt hinterher.
  „Miau" etwas öfter.
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
  Zeile füllt (`fortschritt_balken`, `
`, höchstens ~12×/s neu gezeichnet):
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

- [x] ~~**Handy-Test** der Joker auf echten Geräten~~ – erledigt 01.10.2026,
      läuft flüssig.
- [x] ~~Version 91 → 92~~ – erledigt; **aktueller Stand ist 1.5.7** (veröffentlicht; weiter 1.5 … 1.9, 1.10 …; kleine Nachlieferungen als 1.4.1, 1.4.2 …).
      Nächstes Release also 1.5.7 → 1.6 (oder 1.5.8) (`server/paths.py`, `web/static/app.js`,
      `?v=` in `web/index.html` + `web/tv.html`, `paket/START-HIER.txt`).
- [x] ~~Stufen-Schild auf den kleinen Listenkarten~~ – dort ausgeblendet.
- [x] ~~TV-Ansicht zeigt alle Karten sofort offen~~ – Spielerkarten jetzt erst
      nach dem Aufdecken (Joker-Moment ebenso). Falls doch anders gewünscht:
      `offen(c)` in `tv.js`.
- [ ] Geparkte Joker-Stile ggf. später weiterentwickeln (Ideen: Zerrissen noch
      feiner, Entladung als Alternative zu Blitz).

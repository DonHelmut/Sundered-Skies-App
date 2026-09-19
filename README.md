# Sundered Skies – Initiative (lokal)

> ## ▶ ZUM SPIELEN HIER HERUNTERLADEN
> ### **[» SunderedSkies-App.zip (fertiges Paket) «](https://github.com/DonHelmut/Sundered-Skies-App/releases/latest)**
>
> Den **ganzen Ordner** entpacken → **`START.bat`** (oder `SunderedSkiesInitiative.exe`)
> starten → fertig. Kein Python, kein Git, nichts zu installieren.
> Update von einer älteren Version: den Ordner **`data`** von der alten .exe in den
> neuen Ordner kopieren, sonst fehlen Charaktere und Bilder.
>
> ⚠️ **Nicht** den grünen **Code → Download ZIP**-Knopf nehmen – darin ist nur der
> Quellcode **ohne** .exe. Das spielbare Paket gibt es **nur** über den Link oben
> (rechts auf der Startseite unter **Releases**).

---

Digitaler Initiative-Kartenstapel für **Savage Worlds: Sundered Skies**, der
komplett **lokal auf dem Spielleiter-Laptop** läuft. Die Spieler öffnen nur
eine Webseite auf ihrem Handy – **nichts zu installieren, kein Internet nötig**
(nur ein gemeinsames WLAN).

## Starten

Doppelklick auf **`start.bat`**.

Beim ersten Mal wird automatisch eine virtuelle Python-Umgebung angelegt und
alle Abhängigkeiten installiert (dafür einmalig eine Internetverbindung). Danach
läuft alles offline.

Es öffnet sich die **Spielleiter-Ansicht** im Browser und im Terminal steht ein
**QR-Code** samt Adresse.

> Voraussetzung: **Python 3** muss installiert sein
> (https://www.python.org/downloads/, beim Setup „Add Python to PATH" ankreuzen).

## Wer ist was?

- **Laptop** (öffnet automatisch `http://localhost:8000/`) → **Spielleiter**.
- **Handys** (scannen den QR-Code / öffnen `http://<laptop-ip>:8000/`) → **Spieler**.
- **Zweiter Bildschirm / Beamer**: `http://<laptop-ip>:8000/tv` → große,
  read-only **TV-Ansicht** (Runde, aktueller Akteur, Reihenfolge, Timer).

Die Rolle entscheidet der Server automatisch anhand der Adresse – Spieler können
nicht versehentlich Spielleiter werden. Klappt der hübsche Name
`http://pen-and-paper.local:8000/` bei einem Gerät nicht, einfach den QR-Code
oder die IP-Adresse nehmen.

## Bedienung (Spielleiter)

1. **Charakterliste** anlegen (Name, Wild Card, Karten-Talente, Glück/Großes
   Glück). Bleibt dauerhaft gespeichert – nur einmal pflegen.
2. Spieler treten per QR-Code bei und wählen ihren Charakter (oder Gast-Namen).
3. **Gegner/NPCs** hinzufügen (Wild Card optional) – einzeln, aus dem
   **Bestiarium** oder als komplette **Begegnung** (siehe unten).
4. **Neue Runde austeilen** – jeder bekommt seine Initiativekarte (mit
   Talent-Effekten), die Reihenfolge wird sortiert.
5. **Freigeben ▶** startet den Ring-Timer des aktuellen Akteurs. **Zug
   bestätigen ✓** (vom SL oder vom aktiven Spieler am Handy) beendet den Zug.
   Läuft der Timer ab, endet der Zug ebenfalls – es geht aber erst weiter, wenn
   der SL wieder **freigibt** (Zeit zum Würfeln/Schaden notieren).
6. **Nachricht/Bild** an einen Spieler oder an alle senden.
7. **Rückgängig** macht die letzte Aktion mehrstufig rückgängig.
8. **Teilnehmer verwalten**: pro Zeile umbenennen (✎), Wild Card umschalten,
   neu ziehen (🔄), als aktiv setzen (▶), **pausieren** (nimmt kurzzeitig nicht
   am Kampf teil und bekommt keine Karten), entfernen/kicken (✕).

Die SL-Steuerleiste läuft mit und bleibt sichtbar – pro Zug muss nicht gescrollt
werden.

## Initiative-Regeln

- 54-Karten-Deck. Reihenfolge: höhere Karte zuerst, Farb-Tiebreak
  **Pik > Herz > Karo > Kreuz**. Joker schlägt alles, schwarzer Joker schlägt roten.
- Wird ein **Joker** ausgeteilt, wird **vor der nächsten Runde** komplett
  gemischt (regelkonform, keine Karte geht verloren).
- **Abwarten:** Wer einen Joker hat, kann am Handy „Abwarten" wählen und mit
  „Jetzt eingreifen!" jederzeit den aktuellen Zug unterbrechen.

### Talente (kartenrelevant)

- **Schnell** – Karte ≤5 abwerfen und neu ziehen, bis >5.
- **Kühler Kopf** – zieht 2 Karten, die bessere zählt.
- **Sehr Kühler Kopf** – zieht 3 Karten, die beste zählt.
- **Zögerlich** – zieht 2 Karten, die schlechtere zählt (Joker gilt trotzdem).
- **Berechnend / Mächtiger Hieb / Volltreffer / Energieschub** – nur Hinweise,
  die bei passender Karte (≤5 bzw. Joker) eingeblendet werden. Zusätzlich zeigt
  jeder Joker-Halter „+2 auf alle Würfe & Schaden".

*Taktiker / Meistertaktiker sind bewusst (noch) nicht enthalten.*

## Kampfzonen (Entfernung)

Statt einer Battlemap gibt es **fünf abstrakte Entfernungsstufen**. Die Ansicht
ist eine **Konvergenz-Karte**: Gegner oben, Spieler unten, der **⚔️ Nahkampf**
als geteilte Mitte.

| Zone | Bedeutung | Start |
|---|---|---|
| ⚔️ **Nahkampf** | direkt aneinander | – |
| 👣 **Nahbereich** | einen Schritt entfernt | **Spieler starten hier** |
| 🏹 **Fernbereich** | Schusswaffen-Reichweite | – |
| 🎯 **Weitbereich** | weit weg | – |
| 🚫 **Außer Reichweite** | noch nicht im Kampf | **Gegner starten hier** |

- **Spieler** bewegen sich am Handy per Tipp auf ein Band: **ein Schritt gratis**,
  **zwei Schritte = 🏃 Rennen**. Zur Sicherheit muss **zweimal getippt** werden.
  Pro Runde ist **eine** Bewegung erlaubt.
- Der **SL** bewegt frei und beliebig oft – per **Ziehen & Fallenlassen** oder
  über das Figuren-Popup. Mit **Strg-Klick** mehrere Figuren auswählen und
  gemeinsam umsetzen (zählt als *eine* Aktion, ein Rückgängig holt alles zurück).
- Verbündete NSCs zählen zur **Spielerseite**, pausierte Figuren erscheinen gar
  nicht auf der Karte.

## Gruppen

„Die drei Orks" als **eine Einheit** führen: Figuren einer Gruppe zuordnen, dann
**zieht man einmal und alle rücken nach**. Jede Gruppe bekommt eine eigene Farbe,
damit auf einen Blick klar ist, wer zusammengehört. Ausgeschaltete und pausierte
Mitglieder bleiben stehen. Eine Gruppe aufzulösen entfernt **nur** die Gruppe –
die Figuren selbst bleiben im Kampf.

## Bibliotheken & Begegnungen

Dauerhaft gespeichert in `data/`, unabhängig vom laufenden Kampf:

- **🐉 Bestiarium** – Gegner-Vorlagen samt Bild. Einmal anlegen, immer wieder
  einsetzen.
- **🤝 Verbündeten-Bibliothek** – dasselbe für NSC-Verbündete.
- **📋 Begegnungen** – die aktuell aufgestellten NSCs (Gegner *und* Verbündete)
  unter einem Namen sichern: Talente, Wild-Card-Status, Bild, Notiz und
  **Startzone** inklusive. Als Schnappschuss gespeichert, also unabhängig davon,
  ob die Vorlage später geändert wird. Spielerfiguren sind nie dabei.

## Verdeckte Gegner

Pro Gegner umschaltbar. Verdeckte Gegner erscheinen bei den Spielern mit einem
**Tarnnamen** und weichgezeichnetem Bild – der echte Name **verlässt den Laptop
gar nicht erst**, bloßes Weichzeichnen im Browser wäre nur Kosmetik. Der
Tarnname wird aus der Figuren-ID abgeleitet und bleibt dadurch konstant (flackert
nicht bei jedem Update). Der SL sieht immer alles scharf.

Mehrere gleichnamige Gegner werden automatisch **durchnummeriert** („Ork 1",
„Ork 2" …).

## Zustände, Wunden & Bennies

- **Status** pro Teilnehmer: Angeschlagen · Wunden · Ausgeschaltet, plus
  Schnell-Zustände **Verwundbar / Abgelenkt / Am Boden / Betäubt**. SL setzt sie
  für alle (inkl. NPCs), Spieler für sich selbst. Angezeigt als Overlay auf der
  Karte + Badge; Wunden zeigen den Abzug (−1/−2/−3).
- **Wild Card vs. Statist:** Wild Cards vertragen **3** Wunden, Statisten **2**.
  Eine Wunde darüber heißt **ausgeschaltet** (sofern Auto-K.O. eingeschaltet ist).
- **Treffer ☠ / Heilung ✚ mit einem Klick:** Treffer macht *angeschlagen*, beim
  nächsten Mal **+1 Wunde**. Heilung geht denselben Weg rückwärts (erst wieder
  wach, dann Wunden abbauen, zuletzt „Angeschlagen" aufheben).
- **Erholung** von „Angeschlagen" – entweder frei (bestandene Willenskraft-Probe
  am Tisch) oder **per Benny**.
- **Bennies** (nur Wild Cards): SL stellt den Startwert ein, **Glück/Großes
  Glück** geben +1/+2. Jeder kann +/− (nie unter 0). **Auffrischen** setzt alle
  Wild Cards auf ihren Startwert (für Sitzungsbeginn). Extra: **SL-Benny-Pool**.
- **Ausgeschaltete aufräumen** entfernt alle K.O.-Gegner auf einmal –
  Verbündete und Spielerfiguren bleiben stehen, auch wenn sie K.O. sind.

## Spieler-Anfragen

Statt selbst am Spielstand zu drehen, können Spieler beim SL **anfragen**
(Benny ausgeben, sich erholen, Wunde eintragen). Der SL bestätigt oder lehnt ab.
Doppelte Anfragen werden unterdrückt. Das ganze System lässt sich **komplett
abschalten** – dann sehen die Spieler den Knopf gar nicht erst.

## Einstellungen (bleiben dauerhaft)

| Schalter | Wirkung |
|---|---|
| **Timer-Startwert** | Sekunden pro Zug |
| **Benny-Startwert** | womit Wild Cards in die Sitzung starten |
| **Auto-Freigabe** | nächster Zug startet automatisch, ohne ▶-Klick |
| **Auto-K.O.** | eine Wunde über dem Maximum schaltet automatisch aus |
| **Zusatz-Zustände** | Verwundbar/Abgelenkt/Am Boden/Betäubt ein-/ausblenden |
| **Spieler-Anfragen** | ganz an oder aus |
| **Benny an SL** | ausgegebene Bennies wandern in den SL-Pool |

## Optik

- **7 Skins** (oben rechts umschaltbar, pro Gerät gespeichert): Sand & Bronze,
  Giftnebel, Blut & Leder, Dark Mode, Glutstein, Nebelmeer, Pergament (hell,
  Voreinstellung).
- Karten mit Flip-Aufdeckung, Foil-Sheen, Deal-in-Flug, Reorder-Slide; der Joker
  bekommt einen Vollbild-Moment. Kartenwerte deutsch: **B**ube, **D**ame,
  **K**önig, **A**ss.
- **Mimi die Katze** 🐈 – ein optionales, rein optisches Gimmick (oben rechts an-/
  ausschaltbar, pro Gerät). Zweiter Schalter für ihren „Schabernack". Nichts
  Spielentscheidendes.

## Speichern & Sicherung

- **Charakterliste**, **Bibliotheken**, **Begegnungen**, **laufender Kampf** und
  **Einstellungen** werden fortlaufend als JSON in `data/` gespeichert. Von den
  dauerhaften Dateien bleibt jeweils die Vorversion als `.bak` liegen – das
  schützt gegen einen abgebrochenen Schreibvorgang.
- Nach einem Neustart fragt der SL-Bildschirm **„Letzte Sitzung fortsetzen?"**.
- **Export/Import:** alles Dauerhafte in *einer* Sicherungsdatei – zum Umziehen
  auf einen anderen Laptop. Der Import **ersetzt** Charaktere, Bibliotheken und
  Begegnungen (der laufende Kampf bleibt unberührt) und meldet hinterher, was
  übernommen und was verworfen wurde. Eine kaputte oder fremde Datei füllt die
  Liste also nicht mit Müll.
- **Bilder aufräumen** löscht hochgeladene Bilder, die niemand mehr benutzt.

## Wenn das Netzwerk zickt

Auf Firmen- und Dienst-Laptops sperrt die IT gern genau das, was die App braucht.
Eingebaute Hilfen:

- **Firewall-Freigabe per Knopfdruck** (nur vom Laptop aus, fragt per UAC nach)
  – gibt alle Ports der App frei und **prüft danach nach**, ob die Regel wirklich
  angelegt wurde.
- **Ausweich-Ports**, falls 8000 belegt ist, und ein **Doppelstart-Dialog**
  statt einer Sackgasse.
- **Netz-Wächter:** WLAN-Aussetzer und Adresswechsel werden erkannt; angefangene
  Eingaben gehen beim Wiederverbinden nicht verloren.
- **Internet weg, WLAN noch da?** Dann schalten viele Handys still auf
  **Mobilfunk** um und finden den Laptop nicht mehr, obwohl „WLAN verbunden"
  dasteht. Android-Handys (Chrome) erkennen das: Die App zeigt sofort
  „Dein Handy ist auf Mobilfunk umgesprungen" samt Lösung, verbindet sich neu,
  sobald wieder WLAN aktiv ist, und vermerkt es im Log. Vorbeugend – der Tipp steht
  auch auf der Beitrittsseite: **Flugmodus an, danach nur WLAN wieder an.**
- `data/log.txt` protokolliert Firewall-Status, Adressen und Spielernamen –
  das ist die Datei, die bei Problemen weiterhilft.
- Notfalls die Skripte in `paket/`: `Firewall-freigeben.bat`,
  `WLAN-Stromsparen-aus.bat`.

## Technik

Python (FastAPI + WebSockets) als lokaler Server, Frontend als schlichtes
HTML/CSS/JS (keine Build-Tools). Karten sind handgezeichnetes SVG. Statische
Dateien werden mit `no-cache` ausgeliefert, damit Updates immer laden.

- `server/engine.py` – Deck, Savage-Worlds-Sortierung, Talent-Logik
- `server/game.py` – Spielzustand, Aktionen, Undo, Persistenz
- `server/app.py` – Server, WebSocket-Sync, Rollen-Erkennung, Bild-Upload, `/tv`
- `server/run.py` – Start, IP/QR/mDNS, Browser öffnen
- `server/winnet.py` – Firewall-Freigabe und Netzwerk-Erkennung (Windows)
- `server/paths.py` – Datenordner, Version, Ausweich-Pfade
- `server/diag.py` – Protokoll (`data/log.txt`)
- `web/index.html`, `web/tv.html` – SL-/Spieler-Ansicht und TV-Ansicht
- `web/static/cards.js` – Karten als SVG
- `web/static/app.js` – SL-/Spieler-Logik
- `web/static/zones.js` – Zonen-Board (gemeinsam für SL, Spieler, TV)
- `web/static/tv.js` – TV-Ansicht
- `web/static/mimi.js` – Mimi die Katze
- `web/static/style.css` – Styling & Skins

### Entwickeln & Testen

```
start.bat                                     REM legt .venv an und startet
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m pytest                REM 92 Tests
run-tests.bat                                 REM dasselbe als Doppelklick
```

Vor jedem Release die Version an **drei** Stellen hochzählen – `server/paths.py`
(`APP_VERSION`), `web/static/app.js` (`ASSET_VERSION`) und `?v=NN` in
`web/index.html` + `web/tv.html` – dazu die Versionszeile in
`paket/START-HIER.txt`. Stimmen Server- und Seitenversion nicht überein, warnt
die App von selbst („Alte Seite im Cache"). Details zum Paketbau:
`paket/LIESMICH-ENTWICKLER.txt`.

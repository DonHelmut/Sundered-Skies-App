# Sundered Skies – Initiative (lokal)

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
3. **Gegner/NPCs** hinzufügen (Wild Card optional).
4. **Neue Runde austeilen** – jeder bekommt seine Initiativekarte (mit
   Talent-Effekten), die Reihenfolge wird sortiert.
5. **Freigeben ▶** startet den Ring-Timer des aktuellen Akteurs. **Zug
   bestätigen ✓** (vom SL oder vom aktiven Spieler am Handy) beendet den Zug.
   Läuft der Timer ab, endet der Zug ebenfalls – es geht aber erst weiter, wenn
   der SL wieder **freigibt** (Zeit zum Würfeln/Schaden notieren).
6. **Nachricht/Bild** an einen Spieler oder an alle senden.
7. **Rückgängig** macht die letzte Aktion mehrstufig rückgängig.
8. **Teilnehmer verwalten**: pro Zeile umbenennen (✎), Wild Card umschalten,
   neu ziehen (🔄), als aktiv setzen (▶), entfernen/kicken (✕).

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

## Zustände, Wunden & Bennies

- **Status** pro Teilnehmer: Angeschlagen · Wunden · Ausgeschaltet, plus
  Schnell-Zustände **Verwundbar / Abgelenkt / Am Boden / Betäubt**. SL setzt sie
  für alle (inkl. NPCs), Spieler für sich selbst. Angezeigt als Overlay auf der
  Karte + Badge; Wunden zeigen den Abzug (−1/−2/−3).
- **Wild Card vs. Statist:** Wild Cards halten 1–3 Wunden aus; Statisten sind bei
  *einer* Wunde ausgeschaltet (kein Wunden-Regler).
- **Bennies** (nur Wild Cards): SL stellt den Startwert ein, **Glück/Großes
  Glück** geben +1/+2. Jeder kann +/− (nie unter 0). **Auffrischen** setzt alle
  Wild Cards auf ihren Startwert (für Sitzungsbeginn). Extra: **SL-Benny-Pool**.

## Optik

- **7 Skins** (oben rechts umschaltbar, pro Gerät gespeichert): Sand & Bronze,
  Giftnebel, Blut & Leder, Dark Mode, Glutstein, Nebelmeer, Pergament (hell).
- Karten mit Flip-Aufdeckung, Foil-Sheen, Deal-in-Flug, Reorder-Slide; der Joker
  bekommt einen Vollbild-Moment. Kartenwerte deutsch: **B**ube, **D**ame,
  **K**önig, **A**ss.
- **Mimi die Katze** 🐈 – ein optionales, rein optisches Gimmick (oben rechts an-/
  ausschaltbar, pro Gerät). Zweiter Schalter für ihren „Schabernack". Nichts
  Spielentscheidendes.

## Speichern

- **Charakterliste**, **laufender Kampf** und **Einstellungen** (Timer-/Benny-
  Startwert) werden fortlaufend als JSON in `data/` gespeichert.
- Der zuletzt gesetzte Timer-/Benny-Startwert bleibt als Default erhalten.
- Nach einem Neustart fragt der SL-Bildschirm **„Letzte Sitzung fortsetzen?"**.

## Technik

Python (FastAPI + WebSockets) als lokaler Server, Frontend als schlichtes
HTML/CSS/JS (keine Build-Tools). Karten sind handgezeichnetes SVG. Statische
Dateien werden mit `no-cache` ausgeliefert, damit Updates immer laden.

- `server/engine.py` – Deck, Savage-Worlds-Sortierung, Talent-Logik
- `server/game.py` – Spielzustand, Aktionen, Undo, Persistenz
- `server/app.py` – Server, WebSocket-Sync, Rollen-Erkennung, Bild-Upload, `/tv`
- `server/run.py` – Start, IP/QR/mDNS, Browser öffnen
- `web/index.html`, `web/tv.html` – SL-/Spieler-Ansicht und TV-Ansicht
- `web/static/cards.js` – Karten als SVG
- `web/static/app.js` – SL-/Spieler-Logik
- `web/static/tv.js` – TV-Ansicht
- `web/static/mimi.js` – Mimi die Katze
- `web/static/style.css` – Styling & Skins

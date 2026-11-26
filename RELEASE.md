# 2.0.27 – Fehler aus dem großen Durchspielen behoben
<!--
  Steht hier eine NEUE Version (gleich APP_VERSION in server/paths.py), baut
  GitHub nach dem Merge auf main automatisch das Release
  (.github/workflows/release.yml). Erste Zeile = Titel, Rest = Release-Notizen
  für die Spieler. Bei jedem Release-PR neu schreiben.
-->

**Behoben**
- ⏳ Countdown, der vor dem ersten Austeilen gesetzt wird, verliert keine Runde mehr (vorher stand „3" in Runde 1 schon auf 2). Dauer-Effekte genauso.
- 🩹 Heilen-Runde: Wer außer Gefecht war und zuerst geheilt wird, muss trotzdem die Konstitution würfeln – die Verletzung fiel sonst einfach weg.
- ⚔ Handys springen bei jedem neuen Kampf wieder auf „Kampf“ – auch wenn der letzte Abend nicht fortgesetzt wurde.
- Beim Aufdecken mit Nebel oder Scherben ließ sich das Handy kurz seitwärts wischen. Jetzt bleibt alles stehen.

**Aktualisieren:** In der App auf „Jetzt aktualisieren“ tippen. Deine Daten (Charaktere, Bibliotheken, Spielstand) bleiben erhalten.

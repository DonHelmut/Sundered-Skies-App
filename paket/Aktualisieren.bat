@echo off
rem Holt die neueste Version von GitHub; der Ordner "data" bleibt erhalten.
rem Alles in EINER Zeile: das Skript ersetzt beim Update auch diese Datei,
rem und cmd liest Batch-Dateien zeilenweise nach - so ist nichts mehr offen.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Aktualisieren.ps1" & exit /b

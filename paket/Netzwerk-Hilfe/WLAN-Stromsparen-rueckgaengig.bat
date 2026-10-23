@echo off
REM Stellt das WLAN-Stromsparen genau so wieder her, wie es vor WLAN-Stromsparen-aus.bat war.
REM Die eigentliche Arbeit macht netzwerk-hilfe.ps1 daneben (sichert vorher alles).
title Sundered Skies - WLAN-Stromsparen rueckgaengig
net session >nul 2>&1
if not errorlevel 1 goto :admin
REM Holt sich die Adminrechte selbst (Windows fragt nach) - frueher musste man
REM "Als Administrator ausfuehren" waehlen, und ohne lief das Skript ins Leere.
set "SKRIPT=%~f0"
powershell -NoProfile -Command "try { Start-Process -FilePath $env:SKRIPT -Verb RunAs -ErrorAction Stop } catch { exit 1 }"
if errorlevel 1 (
  echo.
  echo   Ohne Administrator-Rechte geht es nicht.
  echo   Nochmal starten und die Windows-Nachfrage mit JA beantworten.
  echo.
  pause
)
exit /b
:admin
echo.
echo   WLAN-Stromsparen rueckgaengig
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0netzwerk-hilfe.ps1" -Aktion WlanZurueck
pause

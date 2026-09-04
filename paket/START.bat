@echo off
chcp 65001 >nul
title Sundered Skies - Initiative
rem Startet die Ordnerversion und erklaert den haeufigsten Fehler:
rem jemand kopiert nur die .exe heraus und laesst _internal liegen.
cd /d "%~dp0"
if not exist "_internal\python314.dll" (
  echo.
  echo ====================================================
  echo   Es fehlt der Ordner "_internal"!
  echo ====================================================
  echo.
  echo   Die App braucht IMMER den ganzen Ordner. Vermutlich
  echo   wurde nur die .exe herauskopiert oder das Zip nicht
  echo   richtig entpackt.
  echo.
  echo   Bitte das Zip komplett entpacken und den ganzen
  echo   Ordner an einen festen Platz legen ^(z. B. Desktop^).
  echo.
  pause
  exit /b 1
)
start "" "%~dp0SunderedSkiesInitiative.exe"

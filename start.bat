@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Sundered Skies - Initiative
echo   Erststart installiert alle Abhaengigkeiten
echo ============================================
echo.

REM --- Python finden ---------------------------------------------------------
where py >nul 2>nul
if %errorlevel%==0 (
  set "PYCMD=py -3"
) else (
  where python >nul 2>nul
  if %errorlevel%==0 (
    set "PYCMD=python"
  ) else (
    echo [FEHLER] Python wurde nicht gefunden.
    echo Bitte Python 3 von https://www.python.org/downloads/ installieren
    echo und beim Setup "Add Python to PATH" ankreuzen.
    echo.
    pause
    exit /b 1
  )
)

REM --- Virtuelle Umgebung anlegen (nur beim ersten Mal) ----------------------
if not exist ".venv\Scripts\python.exe" (
  echo [1/3] Erstelle virtuelle Umgebung...
  %PYCMD% -m venv .venv
  if errorlevel 1 (
    echo [FEHLER] Konnte virtuelle Umgebung nicht erstellen.
    pause
    exit /b 1
  )
)

set "VENV_PY=.venv\Scripts\python.exe"

REM --- Abhaengigkeiten installieren / aktualisieren --------------------------
echo [2/3] Installiere Abhaengigkeiten (beim ersten Mal dauert das etwas)...
"%VENV_PY%" -m pip install --upgrade pip >nul 2>nul
"%VENV_PY%" -m pip install -r requirements.txt
if errorlevel 1 (
  echo [FEHLER] Installation der Abhaengigkeiten fehlgeschlagen.
  echo Besteht eine Internetverbindung fuer die Erstinstallation?
  pause
  exit /b 1
)

REM --- Server starten --------------------------------------------------------
echo [3/3] Starte Server...
echo.
"%VENV_PY%" -m server.run

echo.
echo Server beendet.
pause

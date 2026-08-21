@echo off
REM Startet die automatische Test-Suite (braucht die .venv aus start.bat).
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Keine .venv gefunden. Bitte zuerst einmal start.bat ausfuehren.
  pause
  exit /b 1
)
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt --quiet
.venv\Scripts\python.exe -m pytest
pause

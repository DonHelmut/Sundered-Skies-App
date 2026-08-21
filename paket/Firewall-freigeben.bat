@echo off
REM Gibt die Ports der App im lokalen Netz frei, damit Handys sich verbinden
REM koennen (8000 plus die Ausweich-Ports, falls 8000 belegt ist).
REM RECHTSKLICK auf diese Datei -> "Als Administrator ausfuehren".
netsh advfirewall firewall delete rule name="Sundered Skies Initiative" >nul 2>&1
netsh advfirewall firewall add rule name="Sundered Skies Initiative" dir=in action=allow protocol=TCP localport=8000,8001,8010,8080,8088,8123,8765,8899
echo.
if %errorlevel%==0 (
  echo FERTIG: Die Ports der App sind jetzt im lokalen Netz freigegeben.
) else (
  echo FEHLER: Vermutlich ohne Administrator gestartet.
  echo Rechtsklick auf diese Datei  -^>  "Als Administrator ausfuehren".
)
echo.
pause

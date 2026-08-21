@echo off
REM Entfernt die Freigabe fuer Port 8000 wieder (Rueckgaengig zu Firewall-freigeben).
REM RECHTSKLICK auf diese Datei -> "Als Administrator ausfuehren".
netsh advfirewall firewall delete rule name="Sundered Skies Initiative"
echo.
echo Regel entfernt (Port 8000 wieder gesperrt).
echo.
pause

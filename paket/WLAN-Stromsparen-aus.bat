@echo off
chcp 65001 >nul
title WLAN-Stromsparen abschalten
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Bitte RECHTSKLICK auf diese Datei -^> "Als Administrator ausfuehren".
  echo.
  pause
  exit /b 1
)
echo.
echo   Verbiete Windows, die WLAN-Karte zum Stromsparen abzuschalten...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$n=Get-NetAdapter ^| Where-Object {$_.Status -eq Up -and $_.PhysicalMediaType -match 802.11}; if(-not $n){Write-Host   Keine aktive WLAN-Karte gefunden.;exit}; foreach($a in $n){ try{ Set-NetAdapterPowerManagement -Name $a.Name -AllowComputerToTurnOffDevice Disabled -ErrorAction Stop; Write-Host (  OK:  + $a.Name +  darf sich nicht mehr abschalten.) } catch { Write-Host (  Ging nicht fuer  + $a.Name + :  + $_.Exception.Message) } }"
echo.
echo   Fertig. Das gilt dauerhaft, auch nach einem Neustart.
echo.
pause

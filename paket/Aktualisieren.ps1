# Holt die neueste Version der App von GitHub (Releases) und tauscht nur die
# Programmdateien aus. Der Ordner "data" (Charaktere, Bilder, Spielstand)
# bleibt unangetastet - so kann man fuer immer im selben Ordner bleiben,
# statt jedes Mal ein neues Zip zu entpacken und den Spielstand zu suchen.
# Bewusst ohne Umlaute: Windows PowerShell 5.1 liest .ps1 ohne BOM als ANSI.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'   # Fortschrittsbalken bremst Downloads stark aus

$repo   = 'DonHelmut/Sundered-Skies-App'
$ordner = $PSScriptRoot
$exe    = 'SunderedSkiesInitiative.exe'

function Ende([int]$code) {
    Write-Host ''
    if (-not $env:SWS_OHNE_PAUSE) { Read-Host 'Enter druecken zum Schliessen' | Out-Null }   # (Tests)
    exit $code
}

Write-Host '============================================'
Write-Host '  Sundered Skies - Initiative: Aktualisieren'
Write-Host '============================================'
Write-Host ''

if (-not (Test-Path (Join-Path $ordner $exe))) {
    Write-Host "Hier liegt keine $exe - bitte Aktualisieren.bat im App-Ordner starten."
    Ende 1
}

# 1) Installierte Version: steht in der ersten Zeile von START-HIER.txt.
$lokal = $null
$hier = Join-Path $ordner 'START-HIER.txt'
if (Test-Path $hier) {
    $zeile = Get-Content $hier -TotalCount 1
    if ($zeile -match 'Version\s+([0-9][0-9.]*)') { $lokal = $Matches[1] }
}

# 2) Neueste Version auf GitHub.
try {
    $info = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'SunderedSkies-Aktualisieren' }
} catch {
    Write-Host 'Keine Verbindung zu GitHub. Ist der Laptop im Internet?'
    Write-Host "($($_.Exception.Message))"
    Ende 1
}
$neu = ($info.tag_name -replace '^v', '')
$zip = $info.assets | Where-Object { $_.name -eq 'SunderedSkies-App.zip' } | Select-Object -First 1
if (-not $zip) { Write-Host "Im neuesten Release ($neu) fehlt SunderedSkies-App.zip."; Ende 1 }

Write-Host "Installiert: $(if ($lokal) { $lokal } else { 'unbekannt' })"
Write-Host "Neueste:     $neu"
Write-Host ''

# [version] vergleicht 1.10 richtig groesser als 1.9 (reiner Text nicht).
$aktuell = $false
try { $aktuell = $lokal -and ([version]$lokal -ge [version]$neu) } catch { $aktuell = ($lokal -eq $neu) }
if ($aktuell) {
    Write-Host 'Du hast schon die neueste Version. Nichts zu tun.'
    Ende 0
}

# 3) Laeuft die App noch? Dann sind ihre Dateien gesperrt.
$laeuft = Get-Process -Name 'SunderedSkiesInitiative' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path -like "$ordner*" }
if ($laeuft) {
    Write-Host 'Die App laeuft noch. Sie muss zum Aktualisieren kurz beendet werden.'
    $a = Read-Host 'Jetzt beenden? (j/n)'
    if ($a -notmatch '^[jJyY]') { Write-Host 'Abgebrochen - nichts geaendert.'; Ende 1 }
    $laeuft | Stop-Process -Force
    Start-Sleep -Seconds 2
}

# 4) Herunterladen und in einen Zwischenordner entpacken.
$tmp = Join-Path $env:TEMP ("sws-update-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $datei = Join-Path $tmp 'app.zip'
    Write-Host "Lade Version $neu herunter ($([math]::Round($zip.size / 1MB)) MB) ..."
    Invoke-WebRequest $zip.browser_download_url -OutFile $datei -UseBasicParsing
    Write-Host 'Entpacke ...'
    Expand-Archive $datei -DestinationPath (Join-Path $tmp 'neu') -Force
    $quelle = Get-ChildItem (Join-Path $tmp 'neu') -Recurse -Filter $exe | Select-Object -First 1
    if (-not $quelle) { throw "Im Download fehlt $exe." }
    $quelle = $quelle.DirectoryName

    # 5) Austauschen - alles AUSSER data. _internal vorher ganz weg, sonst
    #    blieben Dateien der alten Version liegen.
    Write-Host 'Tausche Programmdateien aus (data bleibt) ...'
    $intern = Join-Path $ordner '_internal'
    if (Test-Path $intern) { Remove-Item $intern -Recurse -Force }
    Get-ChildItem $quelle | Where-Object { $_.Name -ne 'data' } | ForEach-Object {
        Copy-Item $_.FullName -Destination $ordner -Recurse -Force
    }
} catch {
    Write-Host ''
    Write-Host "FEHLER: $($_.Exception.Message)"
    Write-Host 'Falls die App jetzt nicht startet: neueste SunderedSkies-App.zip von'
    Write-Host "https://github.com/$repo/releases/latest holen und den Ordner data hineinkopieren."
    Ende 1
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "Fertig - jetzt Version $neu. Starten wie immer mit START.bat."
Ende 0

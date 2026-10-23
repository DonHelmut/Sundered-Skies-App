# Entwickler-Test der Netzwerk-Hilfe: merkt sich den Zustand, fuehrt Freigeben +
# WLAN-Stromsparen-aus (je zweimal) aus, dann beide Rueckgaengig, und vergleicht.
# Start in PowerShell ALS ADMINISTRATOR (holt sich die ps1 vom Branch):
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/DonHelmut/Sundered-Skies-App/claude/project-thread-tvx1jk/werkzeuge/netzwerk-test.ps1)))
$ErrorActionPreference = 'Stop'
$test = 'C:\nh-test'
$url = 'https://raw.githubusercontent.com/DonHelmut/Sundered-Skies-App/claude/project-thread-tvx1jk/paket/Netzwerk-Hilfe/netzwerk-hilfe.ps1'
New-Item -ItemType Directory -Force "$test\Netzwerk-Hilfe" | Out-Null
Invoke-WebRequest -UseBasicParsing $url -OutFile "$test\Netzwerk-Hilfe\netzwerk-hilfe.ps1"
New-Item -ItemType File -Force "$test\SunderedSkiesInitiative.exe" | Out-Null
$skript = "$test\Netzwerk-Hilfe\netzwerk-hilfe.ps1"

function Zustand {
    foreach ($r in @(Get-NetFirewallRule -Direction Inbound)) {
        $p = "$(($r | Get-NetFirewallApplicationFilter).Program)"
        if ($r.DisplayName -match 'Sundered' -or (($p -replace ' ', '') -match 'sunderedskiesinitiative\.exe$')) {
            "REGEL $($r.Name) | $($r.DisplayName) | $($r.Action) | Enabled=$($r.Enabled) | $p"
        }
    }
    Get-NetFirewallProfile | ForEach-Object { "PROFIL $($_.Name) Enabled=$($_.Enabled) AllowInboundRules=$($_.AllowInboundRules)" }
    $klasse = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e972-e325-11ce-bfc1-08002be10318}'
    foreach ($a in @(Get-NetAdapter -Physical | Where-Object { $_.NdisPhysicalMedium -eq 9 })) {
        $pm = try { (Get-NetAdapterPowerManagement -Name $a.Name -ErrorAction Stop).AllowComputerToTurnOffDevice } catch { 'Fehler' }
        $pnp = '(leer)'
        foreach ($k in @(Get-ChildItem $klasse -ErrorAction SilentlyContinue)) {
            $p = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
            if ($p.NetCfgInstanceId -eq $a.InterfaceGuid -and $null -ne $p.PnPCapabilities) { $pnp = $p.PnPCapabilities }
        }
        "WLAN $($a.InterfaceDescription) PowerMgmt=$pm PnPCapabilities=$pnp"
    }
    "ENERGIE " + ((powercfg /query SCHEME_CURRENT 19cbb8fa-5279-450e-9fac-8a3d5fedd0c1 12bbebe6-58d6-4636-95bb-3217ef867c1a | Select-String '0x') -join ' / ')
    "SICHERUNG da=" + (Test-Path "$env:ProgramData\Sundered Skies Initiative")
}

$vorher = @(Zustand)
foreach ($a in 'FirewallFrei', 'FirewallFrei', 'WlanAn', 'WlanAn') {
    Write-Host "===== $a" -ForegroundColor Cyan
    & powershell -NoProfile -ExecutionPolicy Bypass -File $skript -Aktion $a
}
Write-Host "===== Sicherung" -ForegroundColor Cyan
Get-ChildItem "$env:ProgramData\Sundered Skies Initiative" | ForEach-Object { "--- $($_.Name)"; Get-Content $_.FullName }
$mitte = @(Zustand)
Write-Host "===== GEAENDERT (vorher -> waehrenddessen)" -ForegroundColor Cyan
Compare-Object $vorher $mitte | ForEach-Object { "$($_.SideIndicator) $($_.InputObject)" }
foreach ($a in 'FirewallZurueck', 'WlanZurueck') {
    Write-Host "===== $a" -ForegroundColor Cyan
    & powershell -NoProfile -ExecutionPolicy Bypass -File $skript -Aktion $a
}
$nachher = @(Zustand)
Write-Host "===== ERGEBNIS" -ForegroundColor Cyan
$diff = @(Compare-Object $vorher $nachher)
if ($diff) {
    Write-Host "UNTERSCHIED zum Ausgangszustand:" -ForegroundColor Red
    $diff | ForEach-Object { "$($_.SideIndicator) $($_.InputObject)" }
} else {
    Write-Host "GLEICH - alles exakt wie vorher." -ForegroundColor Green
}
Remove-Item -Recurse -Force $test
Read-Host "Fertig. Fenster mit Eingabetaste schliessen (vorher Foto/Kopie vom Text)"

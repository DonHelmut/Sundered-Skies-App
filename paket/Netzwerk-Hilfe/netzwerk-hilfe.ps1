# Netzwerk-Hilfe fuer Sundered Skies Initiative - wird von den vier .bat-Dateien
# daneben aufgerufen (die holen vorher die Adminrechte).
#
# Grundsatz: Die App laeuft oft auf dem Laptop eines Kumpels. Alles, was hier
# umgestellt wird, wird VORHER gesichert, und das passende "rueckgaengig"
# stellt genau diesen Zustand wieder her. Die Sicherung liegt unter
# %ProgramData%\Sundered Skies Initiative - nicht im App-Ordner, sonst waere sie
# weg, sobald jemand eine neue Version frisch entpackt.
#
# Zweimal "freigeben" hintereinander darf die Sicherung NICHT ueberschreiben -
# sonst wuerde der schon geaenderte Zustand als "vorher" gemerkt und das
# Rueckgaengig stellte nichts mehr zurueck.
#
# Nur ASCII in dieser Datei: Windows PowerShell 5.1 liest .ps1 ohne BOM in der
# ANSI-Codepage, Umlaute kaemen verstuemmelt an.

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('FirewallFrei', 'FirewallZurueck', 'WlanAn', 'WlanZurueck')]
    [string]$Aktion
)

$ErrorActionPreference = 'Stop'

# Muss zu server/winnet.py (FIREWALL_RULE_NAME) und server/paths.py
# (PORT_CANDIDATES) passen - ein Test prueft das.
$RegelName = 'Sundered Skies Initiative'
$Ports = @(8000, 8001, 8010, 8080, 8088, 8123, 8765, 8899)

$AppOrdner = Split-Path -Parent $PSScriptRoot
$AppExe = 'SunderedSkiesInitiative.exe'
$SicherungsOrdner = Join-Path $env:ProgramData 'Sundered Skies Initiative'
$FirewallDatei = Join-Path $SicherungsOrdner 'firewall-vorher.json'
$WlanDatei = Join-Path $SicherungsOrdner 'wlan-vorher.json'

# Energiesparplan -> "Drahtlosadaptereinstellungen" -> "Energiesparmodus".
# 0 = Hoechstleistung, 1-3 = immer mehr Sparen (Windows-Standard im Akkubetrieb: 2).
$WlanUntergruppe = '19cbb8fa-5279-450e-9fac-8a3d5fedd0c1'
$WlanEinstellung = '12bbebe6-58d6-4636-95bb-3217ef867c1a'
$EnergieNamen = @{ 0 = 'Hoechstleistung'; 1 = 'wenig sparen'; 2 = 'mittel sparen'; 3 = 'maximal sparen' }

function Ok($text) { Write-Host "  OK       $text" -ForegroundColor Green }
function Info($text) { Write-Host "           $text" }
function Warnung($text) { Write-Host "  ACHTUNG  $text" -ForegroundColor Yellow }
function Fehler($text) { Write-Host "  FEHLER   $text" -ForegroundColor Red }

function Lies-Sicherung($datei) {
    if (Test-Path -LiteralPath $datei) {
        return (Get-Content -LiteralPath $datei -Raw | ConvertFrom-Json)
    }
    return $null
}

function Schreib-Sicherung($datei, $daten) {
    New-Item -ItemType Directory -Force -Path $SicherungsOrdner | Out-Null
    $daten | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $datei -Encoding UTF8
}

function Entferne-Sicherung($datei) {
    Remove-Item -LiteralPath $datei -Force -ErrorAction SilentlyContinue
    if (-not (Get-ChildItem -LiteralPath $SicherungsOrdner -Force -ErrorAction SilentlyContinue)) {
        Remove-Item -LiteralPath $SicherungsOrdner -Force -ErrorAction SilentlyContinue
    }
}

# ConvertFrom-Json macht aus [] und [x] mal ein Array, mal $null - so immer eine Liste.
function Liste($wert) { return @($wert | Where-Object { $null -ne $_ }) }


# --- Firewall -----------------------------------------------------------------

# Blockier-Regeln fuer die App selbst. Windows legt sie STILL an, wenn beim
# ersten Start im Fenster "Zugriff zulassen?" abgebrochen oder ein Haken
# weggelassen wurde ("sundered skies initiative.exe", meist Profil
# Oeffentlich; am Jonsbo lagen zwei). Blockieren schlaegt Freigeben - unsere
# Regel allein half dann nicht, obwohl "freigegeben" gemeldet wurde. Nur Regeln
# fuer Programme aus dem App-Ordner oder fuer unsere .exe (auch an einem alten
# Ort) - fremde Sperren bleiben unangetastet.
function Finde-Blockierregeln {
    $treffer = @()
    foreach ($regel in @(Get-NetFirewallRule -Direction Inbound -Action Block -Enabled True -ErrorAction SilentlyContinue)) {
        $programm = ($regel | Get-NetFirewallApplicationFilter).Program
        if (-not $programm -or $programm -eq 'Any') { continue }
        $voll = [Environment]::ExpandEnvironmentVariables($programm)
        if ($voll.StartsWith($AppOrdner + '\', [StringComparison]::OrdinalIgnoreCase) -or
            [IO.Path]::GetFileName($voll) -eq $AppExe) {
            $treffer += $regel
        }
    }
    return $treffer
}

function Firewall-Freigeben {
    $sicherung = Lies-Sicherung $FirewallDatei
    $neu = $null -eq $sicherung
    if ($neu) {
        $sicherung = [pscustomobject]@{
            Angelegt         = (Get-Date).ToString('dd.MM.yyyy HH:mm')
            RegelVorher      = [bool](Get-NetFirewallRule -DisplayName $RegelName -ErrorAction SilentlyContinue)
            DeaktivierteSperren = @()
            Profile          = @()
        }
        # Sofort schreiben: bricht unten etwas ab, ist das "vorher" trotzdem da.
        Schreib-Sicherung $FirewallDatei $sicherung
    } else {
        Info "Sicherung vom $($sicherung.Angelegt) bleibt erhalten (nicht ueberschrieben)."
    }
    $gesperrt = @(Liste $sicherung.DeaktivierteSperren)
    $profilListe = @(Liste $sicherung.Profile)

    # 1) Unsere Freigabe. Ohne -Profile gilt sie fuer Privat, Oeffentlich und
    #    Domaene - ein als "oeffentlich" eingestuftes WLAN ist damit kein Problem.
    Get-NetFirewallRule -DisplayName $RegelName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName $RegelName -Direction Inbound -Action Allow -Protocol TCP `
        -LocalPort $Ports -Profile Any | Out-Null
    Ok "Freigabe fuer die App angelegt (Ports $($Ports -join ', '))."
    # Zusaetzlich eine Regel fuer die .exe selbst: Kennt Windows das Programm,
    # fragt es beim Start nicht mehr "Zugriff zulassen?" - und ein erneutes
    # "Abbrechen" kann keine neue Sperre anlegen. Gleicher Name, damit der Knopf
    # in der App und "rueckgaengig" beide Regeln zusammen finden.
    $exe = Join-Path $AppOrdner $AppExe
    if (Test-Path -LiteralPath $exe) {
        New-NetFirewallRule -DisplayName $RegelName -Direction Inbound -Action Allow -Program $exe `
            -Profile Any | Out-Null
        Ok "Freigabe fuer $AppExe angelegt."
    }

    # 2) Blockier-Regeln der App ausschalten (nicht loeschen - rueckgaengig schaltet sie wieder ein).
    $sperren = @(Finde-Blockierregeln)
    foreach ($regel in $sperren) {
        try {
            Disable-NetFirewallRule -Name $regel.Name
            if ($gesperrt -notcontains $regel.Name) { $gesperrt += $regel.Name }
            $sicherung.DeaktivierteSperren = $gesperrt
            Schreib-Sicherung $FirewallDatei $sicherung
            Ok "Windows-Sperre fuer die App ausgeschaltet: $($regel.DisplayName)"
        } catch {
            Fehler "Sperre '$($regel.DisplayName)' liess sich nicht ausschalten: $($_.Exception.Message)"
        }
    }
    if (-not $sperren) { Ok "Keine Windows-Sperre fuer die App gefunden." }

    # 3) "Alle eingehenden Verbindungen blockieren, auch zugelassene Apps" -
    #    dann wirkt KEINE Freigabe. Nur fuer dieses Profil aufheben, alten Wert merken.
    foreach ($p in @(Get-NetFirewallProfile)) {
        if ("$($p.AllowInboundRules)" -eq 'False') {
            Set-NetFirewallProfile -Name $p.Name -AllowInboundRules NotConfigured
            if (-not ($profilListe | Where-Object { $_.Name -eq $p.Name })) {
                $profilListe += [pscustomobject]@{ Name = $p.Name; AllowInboundRules = 'False' }
                $sicherung.Profile = $profilListe
                Schreib-Sicherung $FirewallDatei $sicherung
            }
            Ok "Profil '$($p.Name)': 'alle eingehenden blockieren' aufgehoben."
        }
    }

    $sicherung.DeaktivierteSperren = $gesperrt
    $sicherung.Profile = $profilListe
    Schreib-Sicherung $FirewallDatei $sicherung
    if ($neu) { Ok "Vorheriger Zustand gesichert - 'Firewall-rueckgaengig.bat' stellt ihn wieder her." }

    # 4) Was dieses Skript NICHT loesen kann, wenigstens sagen.
    try {
        foreach ($p in @(Get-NetFirewallProfile -PolicyStore ActiveStore)) {
            if ($p.Enabled -and ("$($p.AllowLocalFirewallRules)" -eq 'False' -or "$($p.AllowInboundRules)" -eq 'False')) {
                Warnung "Profil '$($p.Name)': Eine Firmen-Richtlinie ignoriert eigene Freigaben."
                Info "Dann kann dieser Laptop nicht Gastgeber sein -> anderen Laptop nehmen."
            }
        }
    } catch { }
    try {
        $fremd = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName FirewallProduct -ErrorAction Stop |
            ForEach-Object { $_.displayName } | Where-Object { $_ -and $_ -notmatch 'Windows|Defender' })
        if ($fremd) {
            Warnung "Fremde Firewall aktiv: $($fremd -join ', ')"
            Info "Die Windows-Freigabe reicht dann evtl. nicht. Dort die App"
            Info "(SunderedSkiesInitiative.exe) als Ausnahme eintragen."
        }
    } catch { }
    try {
        $oeffentlich = @(Get-NetConnectionProfile | Where-Object { "$($_.NetworkCategory)" -eq 'Public' })
        if ($oeffentlich) {
            Info "WLAN ist als 'oeffentlich' eingestuft - die Freigabe gilt trotzdem."
        }
    } catch { }
}

function Firewall-Zurueck {
    $sicherung = Lies-Sicherung $FirewallDatei
    if ($null -eq $sicherung) {
        # Aeltere Version (ohne Sicherung) oder nur der Knopf in der App: dort
        # wurde nichts anderes geaendert als unsere Regel angelegt.
        Get-NetFirewallRule -DisplayName $RegelName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
        Ok "Freigabe der App entfernt."
        Info "(Keine Sicherung gefunden - sonst war nichts zurueckzustellen.)"
        return $true
    }
    $alles = $true
    Info "Stelle den Zustand vom $($sicherung.Angelegt) wieder her."

    if ($sicherung.RegelVorher) {
        Ok "Freigabe der App bleibt - sie war schon vorher da."
    } else {
        Get-NetFirewallRule -DisplayName $RegelName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
        Ok "Freigabe der App entfernt."
    }
    foreach ($name in (Liste $sicherung.DeaktivierteSperren)) {
        try {
            $regel = Get-NetFirewallRule -Name $name -ErrorAction Stop
            Enable-NetFirewallRule -Name $name
            Ok "Windows-Sperre wieder eingeschaltet: $($regel.DisplayName)"
        } catch {
            Info "Sperre gibt es nicht mehr (inzwischen geloescht) - nichts zu tun."
        }
    }
    foreach ($p in (Liste $sicherung.Profile)) {
        try {
            Set-NetFirewallProfile -Name $p.Name -AllowInboundRules $p.AllowInboundRules
            Ok "Profil '$($p.Name)': 'alle eingehenden blockieren' wieder an."
        } catch {
            Fehler "Profil '$($p.Name)' liess sich nicht zuruecksetzen: $($_.Exception.Message)"
            $alles = $false
        }
    }
    if ($alles) {
        Entferne-Sicherung $FirewallDatei
        Ok "Alles wie vorher."
    } else {
        Warnung "Nicht alles ging - Sicherung bleibt liegen, einfach nochmal ausfuehren."
    }
    return $alles
}


# --- WLAN-Stromsparen ---------------------------------------------------------

function Wlan-Karten {
    # NdisPhysicalMedium 9 = Native 802.11. Auch ausgeschaltete Karten - sonst
    # fehlt eine, die gerade nur nicht verbunden ist.
    return @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
        Where-Object { $_.NdisPhysicalMedium -eq 9 -or "$($_.PhysicalMediaType)" -match '802\.11' })
}

# Registry-Schluessel der Karte unter der Klasse "Netzwerkadapter" - dort steht
# der Haken aus dem Geraete-Manager als PnPCapabilities.
function Karten-Schluessel($karte) {
    $klasse = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e972-e325-11ce-bfc1-08002be10318}'
    foreach ($k in @(Get-ChildItem -LiteralPath $klasse -ErrorAction SilentlyContinue)) {
        $id = (Get-ItemProperty -LiteralPath $k.PSPath -Name NetCfgInstanceId -ErrorAction SilentlyContinue).NetCfgInstanceId
        if ($id -and $id -eq $karte.InterfaceGuid) { return $k.PSPath }
    }
    return $null
}

function Aktiver-Plan {
    $text = (powercfg /getactivescheme) -join ' '
    $m = [regex]::Match($text, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')
    if ($m.Success) { return $m.Value }
    return $null
}

# Liest Netz- und Akku-Wert. Die Ausgabe von powercfg ist uebersetzt - darum
# nur die beiden Hexzahlen am Ende (erst Netzbetrieb, dann Akku), keine Woerter.
function Lies-WlanEnergie($plan) {
    # Sonst wird in PowerShell 5.1 schon die umgeleitete Fehlerausgabe zum Abbruch.
    $ErrorActionPreference = 'Continue'
    $text = (powercfg /query $plan $WlanUntergruppe $WlanEinstellung 2>$null) -join "`n"
    if ($LASTEXITCODE -ne 0) { return $null }
    $werte = @([regex]::Matches($text, '0x([0-9a-fA-F]{8})') | ForEach-Object { [Convert]::ToInt32($_.Groups[1].Value, 16) })
    if ($werte.Count -lt 2) { return $null }
    return [pscustomobject]@{ Netz = $werte[-2]; Akku = $werte[-1] }
}

function Setze-WlanEnergie($plan, $netz, $akku) {
    powercfg /setacvalueindex $plan $WlanUntergruppe $WlanEinstellung $netz
    if ($LASTEXITCODE -ne 0) { throw "powercfg konnte den Wert nicht setzen (Plan $plan)" }
    powercfg /setdcvalueindex $plan $WlanUntergruppe $WlanEinstellung $akku
    if ($LASTEXITCODE -ne 0) { throw "powercfg konnte den Wert nicht setzen (Plan $plan)" }
    # Werte im AKTIVEN Plan greifen erst nach erneutem Aktivieren.
    if ($plan -eq (Aktiver-Plan)) { powercfg /setactive $plan }
}

function Wlan-An {
    $sicherung = Lies-Sicherung $WlanDatei
    $neu = $null -eq $sicherung
    if ($neu) {
        $sicherung = [pscustomobject]@{
            Angelegt = (Get-Date).ToString('dd.MM.yyyy HH:mm')
            Karten   = @()
            Energie  = $null
        }
        Schreib-Sicherung $WlanDatei $sicherung
    } else {
        Info "Sicherung vom $($sicherung.Angelegt) bleibt erhalten (nicht ueberschrieben)."
    }
    $karten = @(Liste $sicherung.Karten)

    # 1) Geraete-Manager -> WLAN-Karte -> Energieverwaltung -> "Computer kann das
    #    Geraet ausschalten, um Energie zu sparen". Greift vor allem beim Einschlafen.
    $alle = Wlan-Karten
    if (-not $alle) { Warnung "Keine WLAN-Karte gefunden (LAN-Kabel?) - Punkt 1 entfaellt." }
    foreach ($karte in $alle) {
        if ($karten | Where-Object { $_.Beschreibung -eq $karte.InterfaceDescription }) {
            Ok "$($karte.Name): schon umgestellt."
            continue
        }
        $eintrag = $null
        try {
            $wert = "$((Get-NetAdapterPowerManagement -Name $karte.Name -ErrorAction Stop).AllowComputerToTurnOffDevice)"
            if ($wert -eq 'Disabled') {
                Ok "$($karte.Name): war schon so eingestellt."
                continue
            }
            if ($wert -ne 'Enabled') { throw "Einstellung hier nicht verfuegbar ($wert)" }
            Set-NetAdapterPowerManagement -Name $karte.Name -AllowComputerToTurnOffDevice Disabled -ErrorAction Stop
            $eintrag = [pscustomobject]@{ Name = $karte.Name; Beschreibung = $karte.InterfaceDescription; Weg = 'Cmdlet'; Wert = $wert }
        } catch {
            # Am Jonsbo scheiterte das Cmdlet fuer "WLAN 2" ("Geraet funktioniert
            # nicht"). Dann direkt der Haken in der Registry: PnPCapabilities = 24
            # heisst "Windows darf das Geraet nicht abschalten" (wirkt nach Neustart).
            $schluessel = Karten-Schluessel $karte
            if (-not $schluessel) {
                Fehler "$($karte.Name): $($_.Exception.Message)"
                continue
            }
            $alt = (Get-ItemProperty -LiteralPath $schluessel -Name PnPCapabilities -ErrorAction SilentlyContinue).PnPCapabilities
            if ($alt -eq 24) {
                Ok "$($karte.Name): war schon so eingestellt."
                continue
            }
            Set-ItemProperty -LiteralPath $schluessel -Name PnPCapabilities -Value 24 -Type DWord
            $eintrag = [pscustomobject]@{ Name = $karte.Name; Beschreibung = $karte.InterfaceDescription; Weg = 'Registry'; Wert = $alt }
            Info "$($karte.Name): ueber die Registry umgestellt - wirkt nach dem naechsten Neustart."
        }
        $karten += $eintrag
        $sicherung.Karten = $karten
        Schreib-Sicherung $WlanDatei $sicherung
        Ok "$($karte.Name): Windows darf die Karte nicht mehr abschalten."
    }

    # 2) Energiesparplan: Energiesparmodus der WLAN-Karte. Im Akkubetrieb steht
    #    er ab Werk auf "mittel sparen" - die Karte doeste dann zwischen den
    #    Paketen und Handys verloren die Verbindung. Das ist der wichtigere Teil.
    $plan = Aktiver-Plan
    $vorher = if ($plan) { Lies-WlanEnergie $plan } else { $null }
    if ($null -eq $vorher) {
        Warnung "Energiesparmodus der WLAN-Karte ist auf diesem Laptop nicht einstellbar."
    } else {
        if ($null -eq $sicherung.Energie) {
            $sicherung.Energie = [pscustomobject]@{ Plan = $plan; Netz = $vorher.Netz; Akku = $vorher.Akku }
            Schreib-Sicherung $WlanDatei $sicherung
        }
        Setze-WlanEnergie $plan 0 0
        $e = $sicherung.Energie
        Ok ("WLAN-Energiesparmodus: Hoechstleistung (vorher Netz: {0}, Akku: {1})." -f $EnergieNamen[[int]$e.Netz], $EnergieNamen[[int]$e.Akku])
    }

    $sicherung.Karten = $karten
    Schreib-Sicherung $WlanDatei $sicherung
    if ($neu) { Ok "Vorheriger Zustand gesichert - 'WLAN-Stromsparen-rueckgaengig.bat' stellt ihn wieder her." }
    Info ""
    Info "Einschlafen verhindert die App selbst, solange sie laeuft."
    Info "Aber: Deckel zuklappen schickt den Laptop trotzdem schlafen."
}

function Wlan-Zurueck {
    $sicherung = Lies-Sicherung $WlanDatei
    if ($null -eq $sicherung) {
        Info "Keine Sicherung gefunden - es wurde nichts umgestellt (oder schon zurueckgestellt)."
        return $true
    }
    $alles = $true
    Info "Stelle den Zustand vom $($sicherung.Angelegt) wieder her."

    foreach ($k in (Liste $sicherung.Karten)) {
        # Ueber die Beschreibung suchen: den Namen ("WLAN", "WLAN 2") kann Windows neu vergeben.
        $karte = Wlan-Karten | Where-Object { $_.InterfaceDescription -eq $k.Beschreibung } | Select-Object -First 1
        if (-not $karte) {
            Info "$($k.Name): Karte gibt es nicht mehr - nichts zu tun."
            continue
        }
        try {
            if ($k.Weg -eq 'Registry') {
                $schluessel = Karten-Schluessel $karte
                if (-not $schluessel) { throw "Registry-Eintrag der Karte nicht gefunden" }
                if ($null -eq $k.Wert) {
                    Remove-ItemProperty -LiteralPath $schluessel -Name PnPCapabilities -ErrorAction SilentlyContinue
                } else {
                    Set-ItemProperty -LiteralPath $schluessel -Name PnPCapabilities -Value ([int]$k.Wert) -Type DWord
                }
            } else {
                Set-NetAdapterPowerManagement -Name $karte.Name -AllowComputerToTurnOffDevice $k.Wert -ErrorAction Stop
            }
            Ok "$($karte.Name): darf wieder abgeschaltet werden (wie vorher)."
        } catch {
            Fehler "$($karte.Name): $($_.Exception.Message)"
            $alles = $false
        }
    }
    if ($sicherung.Energie) {
        $e = $sicherung.Energie
        try {
            Setze-WlanEnergie $e.Plan ([int]$e.Netz) ([int]$e.Akku)
            Ok ("WLAN-Energiesparmodus zurueck auf Netz: {0}, Akku: {1}." -f $EnergieNamen[[int]$e.Netz], $EnergieNamen[[int]$e.Akku])
        } catch {
            Fehler "Energiesparplan: $($_.Exception.Message)"
            $alles = $false
        }
    }
    if ($alles) {
        Entferne-Sicherung $WlanDatei
        Ok "Alles wie vorher."
    } else {
        Warnung "Nicht alles ging - Sicherung bleibt liegen, einfach nochmal ausfuehren."
    }
    return $alles
}


# --- Start --------------------------------------------------------------------

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    Fehler "Ohne Administrator-Rechte geht es nicht."
    exit 1
}

Write-Host ""
try {
    switch ($Aktion) {
        'FirewallFrei'    { Firewall-Freigeben; $ok = $true }
        'FirewallZurueck' { $ok = Firewall-Zurueck }
        'WlanAn'          { Wlan-An; $ok = $true }
        'WlanZurueck'     { $ok = Wlan-Zurueck }
    }
} catch {
    Fehler $_.Exception.Message
    $ok = $false
}
Write-Host ""
if ($ok) { exit 0 } else { exit 1 }

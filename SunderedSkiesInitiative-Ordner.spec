# -*- mode: python ; coding: utf-8 -*-
# Ordner-Variante ("onedir") fuer verwaltete/Firmen-Laptops.
#
# Die normale Einzeldatei-.exe entpackt sich bei JEDEM Start nach %TEMP% und
# fuehrt sich von dort aus. Genau das verbieten AppLocker/WDAC-Richtlinien und
# viele Endpoint-Schutz-Programme - der Doppelklick tut dann scheinbar nichts.
# Diese Variante laeuft komplett aus ihrem eigenen Ordner, ohne Temp-Umweg,
# und startet nebenbei deutlich schneller.
from PyInstaller.utils.hooks import collect_submodules, collect_all

datas = [('web', 'web')]
binaries = []
hiddenimports = ['qrcode', 'ifaddr']
hiddenimports += collect_submodules('PIL')
for paket in ('uvicorn', 'websockets', 'httptools', 'anyio', 'zeroconf',
              'pydantic', 'pydantic_core'):
    d, b, h = collect_all(paket)
    datas += d; binaries += b; hiddenimports += h

a = Analysis(
    ['sw_initiative.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['pytest', '_pytest', 'pluggy', 'iniconfig', 'pygments',
              'colorama', 'tkinter'],
    noarchive=False,
    optimize=0,
)
# Entwickler-Werkzeuge aus web/static (Musterseite, Testbilder: _lab*) nicht
# ausliefern - sie liegen nur fuer die Entwicklung im Repo.
import os
a.datas = [d for d in a.datas if not os.path.basename(d[0]).startswith('_lab')]
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='SunderedSkiesInitiative',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='SunderedSkies-Ordnerversion',
)

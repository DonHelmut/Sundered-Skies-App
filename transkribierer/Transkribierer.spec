# -*- mode: python ; coding: utf-8 -*-
# Transkribierer.exe - eigenes Werkzeug neben der App (transkribieren.py).
# Ordner-Variante wie die App: eine Einzeldatei-.exe startet aus %TEMP% und
# wird auf Firmen-Laptops blockiert. Die Modelle sind NICHT dabei (ca. 1 GB),
# die laedt das Programm beim ersten Start nach "modelle" neben der .exe.
#
# Bauen (im Ordner transkribierer, eigene .venv):
#   python -m venv .venv
#   .venv\Scripts\python -m pip install -r requirements.txt pyinstaller
#   .venv\Scripts\python -m PyInstaller Transkribierer.spec --noconfirm --clean
from PyInstaller.utils.hooks import collect_all

datas, binaries, hiddenimports = [], [], []
for paket in ('sherpa_onnx', 'av'):
    d, b, h = collect_all(paket)
    datas += d; binaries += b; hiddenimports += h

a = Analysis(
    ['transkribieren.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # tkinter bleibt drin: Dateiauswahl beim Doppelklick.
    excludes=['pytest', '_pytest', 'scipy', 'matplotlib', 'torch'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Transkribierer',
    contents_directory='_transkribierer',
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
    name='Transkribierer',
)

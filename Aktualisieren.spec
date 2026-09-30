# -*- mode: python ; coding: utf-8 -*-
# Aktualisieren.exe - holt die neueste Version von GitHub (aktualisieren.py).
#
# Ordner-Variante wie die App (siehe SunderedSkiesInitiative-Ordner.spec): eine
# Einzeldatei-.exe startet aus %TEMP% und wird auf Firmen-Laptops blockiert.
# Eigener Unterordner "_aktualisieren" statt "_internal": den Ordner der App
# muss der Updater ja austauschen, seinen eigenen kann er waehrend er laeuft
# nicht anfassen. Gebaut wird nach dist\Aktualisieren; beim Paketbau kommen
# Aktualisieren.exe und _aktualisieren direkt neben SunderedSkiesInitiative.exe.

a = Analysis(
    ['aktualisieren.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['pytest', '_pytest', 'tkinter', 'server', 'fastapi', 'uvicorn',
              'pydantic', 'PIL', 'qrcode', 'zeroconf'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Aktualisieren',
    contents_directory='_aktualisieren',
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
    name='Aktualisieren',
)

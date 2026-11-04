"""Stückweises Neuzeichnen (render.js/domAbgleichen) im echten Browser.

Bug 1.5.34: eine gespeicherte Spieler-Notiz war nach dem Neuladen weg. Der
Server hatte sie, aber domAbgleichen zog den Text der neuen <textarea> aus dem
Template und setzte das Feld danach auf den (nun leeren) Template-Wert.

Läuft nur, wo Node + Playwright + Chromium da sind (Cloud/Entwickler-PC mit
Playwright); sonst übersprungen - die übrigen Tests brauchen keinen Browser.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

RENDER_JS = Path(__file__).resolve().parent.parent / "web" / "static" / "render.js"

SKRIPT = r"""
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent('<div id="root"></div>');
  await p.addScriptTag({ path: process.argv[2] });
  const r = await p.evaluate(() => {
    const root = document.getElementById('root');
    // Erst leer (Stand vor dem Wiederbeitreten), dann mit Notiz vom Server.
    domAbgleichen(root, '<textarea id="n"></textarea><select id="s"><option>a</option></select>');
    domAbgleichen(root, '<textarea id="n">Rask schuldet 50 Gold</textarea>'
      + '<select id="s"><option>a</option><option>b</option><option selected>c</option></select>'
      + '<input id="i" value="neu">');
    return { notiz: root.querySelector('#n').value, wahl: root.querySelector('#s').value,
             feld: root.querySelector('#i').value };
  });
  console.log(JSON.stringify(r));
  await b.close();
})().catch((e) => { console.error(e); process.exit(2); });
"""


def _node_mit_playwright():
    node = shutil.which("node")
    if not node:
        return None
    ok = subprocess.run([node, "-e", "require('playwright')"], capture_output=True)
    return node if ok.returncode == 0 else None


def test_gespeicherte_notiz_steht_nach_neuladen_im_feld(tmp_path):
    node = _node_mit_playwright()
    if not node:
        pytest.skip("Node + Playwright nicht vorhanden")
    skript = tmp_path / "abgleich.js"
    skript.write_text(SKRIPT, encoding="utf-8")
    lauf = subprocess.run([node, str(skript), str(RENDER_JS)], capture_output=True,
                          text=True, timeout=60)
    if lauf.returncode == 2 and "Executable doesn't exist" in lauf.stderr:
        pytest.skip("Chromium für Playwright fehlt")
    assert lauf.returncode == 0, lauf.stderr
    r = json.loads(lauf.stdout.strip().splitlines()[-1])
    assert r == {"notiz": "Rask schuldet 50 Gold", "wahl": "c", "feld": "neu"}

#!/usr/bin/env python3
"""Inline the logo art and the print: billing.src.html -> index.html.

The .src.html file is the one to edit. The wordmark and the fox are base64 in
../../home/first-run/assets.json (the same file the Home mock builds from). The
print is the full-strength Crest tile (../../background-print/tiles/print-crest.svg);
the page sets its strength with the layer's opacity (--k, 65% of the shipped 10%).
Run: python3 build.py
"""
import base64, json, pathlib

here = pathlib.Path(__file__).parent
design = here.parent.parent
src = (here / 'billing.src.html').read_text(encoding='utf-8')
assets = json.loads((design / 'home' / 'first-run' / 'assets.json').read_text(encoding='utf-8'))
tile = (design / 'background-print' / 'tiles' / 'print-crest.svg').read_bytes()
uri = 'url("data:image/svg+xml;base64,' + base64.b64encode(tile).decode('ascii') + '")'
out = (src.replace('__FOX__', assets['fox'])
          .replace('__WORDMARK__', assets['wordmark'])
          .replace('__TILE__', uri))
(here / 'index.html').write_text(out, encoding='utf-8')
print('built index.html', len(out), 'bytes')

#!/usr/bin/env python3
"""Render BILLING-HANDOFF.md as a shareable web page: handoff.html next to this file.

    python3 build_handoff.py

Same page shell as the Crest handoff (docs/design/background-print/build_handoff_page.py):
the Crest print at 10% on white, one solid white sheet, Figtree, light only.
"""
import base64
import html
import pathlib
import re

import markdown

HERE = pathlib.Path(__file__).parent
SRC = HERE / "BILLING-HANDOFF.md"
OUT = HERE / "handoff.html"
TILE = HERE.parent.parent / "background-print" / "tiles" / "crest-10.svg"
UPDATED = "1 October 2026"

lines = SRC.read_text(encoding="utf-8").splitlines()
title = lines[0].lstrip("# ").strip()
md = markdown.Markdown(extensions=["tables", "fenced_code", "sane_lists"])
body = md.convert("\n".join(lines[1:]))

# Task lists: "- [ ] text" -> a box glyph, not a live control.
body = re.sub(r"<li>\[ \] ", '<li class="task"><span class="box" aria-hidden="true"></span>', body)
body = body.replace('<ul>\n<li class="task', '<ul class="tasks">\n<li class="task')
# Wide tables scroll inside their own box; the page never scrolls sideways.
body = body.replace("<table>", '<div class="tablewrap"><table>').replace("</table>", "</table></div>")
# Status words in the rules table become chips.
for word, cls in (("Decided", "ok"), ("Placeholder", "ph"), ("Assumed", "as"), ("Fact", "fa")):
    body = re.sub(rf"<td>{word}( \([^<]*\))?</td>", lambda m, w=word, c=cls: f'<td><span class="st st-{c}">{w}</span>{html.escape(m.group(1) or "")}</td>', body)

toc = []


def slug(s):
    s = html.unescape(re.sub(r"<[^>]+>", "", s)).lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def h2(m):
    text = m.group(1)
    sid = slug(text)
    toc.append((sid, re.sub(r"<[^>]+>", "", text)))
    return f'<h2 id="{sid}">{text}</h2>'


body = re.sub(r"<h2>(.*?)</h2>", h2, body)
# The first section is the one to read first: it gets the signal treatment.
first = toc[0][0]
body = body.replace(f'<h2 id="{first}">', f'<section class="first"><h2 id="{first}">', 1)
second = toc[1][0]
body = body.replace(f'<h2 id="{second}">', f'</section><h2 id="{second}">', 1)
toc_html = "".join(f'<li><a href="#{sid}">{html.escape(t)}</a></li>' for sid, t in toc)
print_uri = "data:image/svg+xml;base64," + base64.b64encode(TILE.read_bytes()).decode()

page = f"""<meta charset="utf-8">
<title>{html.escape(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap">
<style>
/* Layout: one solid white sheet on the Crest print; the read-first section sits in a teal-washed box. Light only. */
:root{{color-scheme:light;--paper:#FFFFFF;--ink:#201C2E;--ink3:#4E4860;--ink4:#645E78;--ink25:#B4AFC4;--rule:#E4E1EC;--rule2:#EFEDF4;--cell:#FBFAFD;
--accent:#5B45D6;--accent2:#4A36B8;--wash:#EFECFD;--ok:#0F6B45;--ok-wash:#E7F3ED;--warn:#8A5300;--warn-wash:#FBF3E4;--signal:#0B7285;--signal-ink:#0A4A57;--signal-wash:#E2F1F5;--signal-line:#B9DCE5;
--edge:0 0 0 1px rgba(32,28,46,.07),inset 0 1px 0 #FFFFFF,0 1px 2px rgba(32,28,46,.06),0 10px 22px -12px rgba(32,28,46,.20);
--font:"Figtree",-apple-system,"Segoe UI","Helvetica Neue",sans-serif;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace}}
*{{box-sizing:border-box}}
html{{background:var(--paper)}}
body{{margin:0;padding:32px 16px 64px;background:var(--paper) url("{print_uri}") 0 0/360px 240px repeat;color:var(--ink);font-family:var(--font);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}}
@media print,(forced-colors:active){{body{{background-image:none}}}}
.sheet{{max-width:900px;margin:0 auto;padding:40px 48px 48px;background:var(--paper);border-radius:22px;box-shadow:var(--edge)}}
@media (max-width:640px){{body{{padding:16px 16px 40px}}.sheet{{padding:26px 20px 32px;border-radius:16px}}}}
header h1{{margin:0 0 6px;font-size:30px;line-height:1.15;font-weight:700;letter-spacing:-.02em;text-wrap:balance}}
.byline{{margin:0 0 22px;font-size:13px;color:var(--ink4)}}
nav.toc{{margin:0 0 26px;padding:14px 18px;border-radius:12px;background:var(--cell);border:1px solid var(--rule2)}}
nav.toc p{{margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--ink4)}}
nav.toc ol{{margin:0;padding:0 0 0 18px;columns:2;column-gap:24px;font-size:13.5px;line-height:1.7}}
@media (max-width:640px){{nav.toc ol{{columns:1}}}}
nav.toc a{{color:var(--accent2);text-decoration:none}}nav.toc a:hover{{text-decoration:underline;text-underline-offset:3px}}
section.first{{margin:0 -20px;padding:22px 20px 8px;border-radius:16px;background:var(--signal-wash);box-shadow:inset 0 0 0 1px var(--signal-line)}}
@media (max-width:640px){{section.first{{margin:0 -8px;padding:18px 12px 4px}}}}
section.first h2{{margin-top:0;padding-top:0;border-top:0;color:var(--signal-ink)}}
section.first .tablewrap{{background:var(--paper);border-color:var(--signal-line)}}
section.first th{{background:var(--paper)}}
h2{{margin:36px 0 10px;padding-top:22px;border-top:1px solid var(--rule2);font-size:21px;line-height:1.25;font-weight:700;letter-spacing:-.015em;scroll-margin-top:16px;text-wrap:balance}}
h3{{margin:22px 0 6px;font-size:16px;font-weight:700}}
p{{margin:0 0 12px;max-width:74ch}}
ul,ol{{margin:0 0 14px;padding-left:22px}}
li{{margin:0 0 6px;max-width:76ch}}li>ul,li>ol{{margin-top:6px}}
a{{color:var(--accent2)}}
code{{font-family:var(--mono);font-size:.86em;padding:1px 5px;border-radius:5px;background:var(--wash);color:var(--accent2);word-break:break-word}}
strong{{font-weight:700}}
.tablewrap{{margin:0 0 16px;overflow-x:auto;border:1px solid var(--rule2);border-radius:12px}}
table{{border-collapse:collapse;width:100%;min-width:600px;font-size:13.5px;line-height:1.45}}
th,td{{padding:9px 12px;border-bottom:1px solid var(--rule2);vertical-align:top;text-align:left}}
th{{background:var(--cell);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink4);white-space:nowrap}}
tr:last-child td{{border-bottom:0}}
td:first-child{{font-variant-numeric:tabular-nums}}
.st{{display:inline-block;margin-right:6px;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;white-space:nowrap}}
.st-ok{{background:var(--ok-wash);color:var(--ok)}}.st-ph{{background:var(--warn-wash);color:var(--warn)}}.st-as{{background:var(--wash);color:var(--accent2)}}.st-fa{{background:var(--cell);color:var(--ink4);box-shadow:inset 0 0 0 1px var(--rule)}}
ul.tasks{{list-style:none;padding-left:0}}
li.task{{position:relative;padding-left:28px}}
li.task .box{{position:absolute;left:2px;top:4px;width:15px;height:15px;border-radius:4px;border:1.5px solid var(--ink25);background:var(--paper)}}
footer{{margin-top:36px;padding-top:16px;border-top:1px solid var(--rule2);font-size:12.5px;color:var(--ink4)}}
</style>
<div class="sheet">
<header>
<h1>{html.escape(title)}</h1>
<p class="byline">Wiskr admin · dev handoff · updated {UPDATED} · code references checked against <code>origin/main</code> at <code>2baf388</code> · source files: <code>billing-handoff.zip</code>, from the owner</p>
</header>
<nav class="toc" aria-label="Sections"><p>Sections</p><ol>{toc_html}</ol></nav>
{body}
<footer>Rebuilt from <code>docs/design/settings/billing/BILLING-HANDOFF.md</code> by <code>build_handoff.py</code>.</footer>
</div>
"""
OUT.write_text(page, encoding="utf-8")
print(OUT.name, len(page) // 1024, "KB,", len(toc), "sections")

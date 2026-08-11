import { build } from "./build.mjs";
import * as Q from "./q-defs.mjs";
for (const d of [Q.rail, Q.masthead, Q.canvas, Q.panes]) {
  const r = build(d);
  console.log(`${d.name.padEnd(10)} ${d.layout.padEnd(9)} ${d.fontSwitcher.padEnd(8)} → ${r.path}  ${(r.bytes/1024).toFixed(0)} KB`);
}

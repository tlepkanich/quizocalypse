import { build } from "./build.mjs";
import { railV2 } from "./v2.mjs";
const r = build(railV2);
console.log(`Rail V2 → ${r.path}  ${(r.bytes/1024).toFixed(0)} KB`);

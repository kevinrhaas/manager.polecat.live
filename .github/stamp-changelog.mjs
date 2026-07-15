// stamp-changelog.mjs — stamp the real ship time onto the newest changelog entry.
//
// Fleet convention (see polecat-platform docs/AUTOMATION.md): every repo owns a
// standalone stamping tool so any shipping agent — the platform steward, the
// dispatch-only self-improve fallback, or a human — stamps timestamps the same
// way before merge. Nothing stamps after merge.
//
// An agent leaves `ts: ''` on the new top entry; this fills it with the real
// time. It also overwrites the top entry's `ts` when it is unparseable OR set
// in the future, so a hard-coded (often round, future) timestamp still ends up
// real. Legitimate past stamps on the top entry are left untouched.
//
// Run: node .github/stamp-changelog.mjs   (from the repo root)
import { readFile, writeFile } from 'node:fs/promises';

const FILE = 'js/changelog.js';
const now = new Date();
const nowIso = now.toISOString();

let src = await readFile(FILE, 'utf8');
let changed = false;

// Only the FIRST `ts:` in the file — the newest entry sits at the top.
src = src.replace(/ts:\s*'([^']*)'/, (m, val) => {
  const t = Date.parse(val);
  if (!val || isNaN(t) || t > now.getTime() + 60000) {
    changed = true;
    return `ts: '${nowIso}'`;
  }
  return m;
});

await writeFile(FILE, src);
console.log(changed
  ? `Stamped top changelog entry: ${nowIso}`
  : 'Top changelog ts already valid; left as-is.');

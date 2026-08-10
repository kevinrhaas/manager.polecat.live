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


// ---- version assignment (fleet contract, 2026-08-10) ----------------------
// Authors write `v: null`; the number is assigned HERE, after any merge, where
// the real answer is knowable. Two branches that each prepend an entry both
// compute the same "top + 1", and whichever merges second is silently wrong.
// See polecat-platform docs/SHELL-API.md, and the `merge=union` half of the fix
// in .gitattributes — deriving the number alone does not stop the conflict.
//
// Numbered by POSITION, top being newest, because this tool patches text rather
// than parsing entries: re-serialising the file to sort by ts would reformat
// entries it did not author. Entries that already have a version are never
// touched — Manager keys release rows on `v` and every reader's "seen" marker
// compares against it, so renumbering history would re-notify everyone.
{
  const nulls = [...src.matchAll(/v:\s*null/g)];
  if (nulls.length) {
    const firstNumbered = src.match(/v:\s*(\d+)/);
    const base = firstNumbered ? Number(firstNumbered[1]) : 0;
    for (let i = nulls.length - 1, n = base; i >= 0; i--) {
      const m = nulls[i];
      src = src.slice(0, m.index) + `v: ${++n}` + src.slice(m.index + m[0].length);
    }
    console.log(`Assigned ${nulls.length} changelog version(s) from v${base}.`);
  }
  // A stamper that emits a duplicate version is worse than one that stops: the
  // duplicate ships and the contract check only catches it later, if at all.
  const vs = [...src.matchAll(/v:\s*(\d+)/g)].map((m) => Number(m[1]));
  for (let i = 1; i < vs.length; i++) {
    if (vs[i - 1] <= vs[i]) {
      console.error(`changelog: versions not strictly decreasing (v${vs[i - 1]} then `
        + `v${vs[i]}) — refusing to write.`);
      process.exit(1);
    }
  }
}

await writeFile(FILE, src);
console.log(changed
  ? `Stamped top changelog entry: ${nowIso}`
  : 'Top changelog ts already valid; left as-is.');

# manager.polecat.live — project guide

Mission control for the Polecat fleet: dashboards, project library, release
timelines, credentials, and a pluggable data-source layer — all in the browser.
Plain HTML + ES modules + CSS, **no build step, no framework, no runtime deps**.
Landing page at `/` (`index.html`, `css/landing.css`); the app lives at `/app/`
(`app/index.html` + `js/*` + `css/styles.css`).

## The app frame runs on Polecat Shell (vendored — READ-ONLY)

`vendor/polecat-shell/` is a versioned copy of the shared fleet UI library from
`kevinrhaas/polecat-platform` (see its docs/SHELL-API.md). It provides the app
frame (`initShell`: rail + topbar + view), the right panel (`rightPanel`), the
waffle app-switcher (`appSwitcher` + `catalog.js` FLEET), theme (`theme.js`,
two axes `data-palette` × `data-theme`, stored at `manager.theme`), the icon
base set (`icons.js`), the What's-New feed (`whatsnew.js`, seen-version at
`manager.whatsnew.seen`), and base component CSS (`shell.css`, `tokens.css`).

**Never edit files under `vendor/polecat-shell/`** — changes there belong in
the platform repo and arrive via `chore: polecat-shell vX.Y.Z` PRs
(MANIFEST.json sha256 hashes are drift-checked by fleet sweeps).

Manager-side conventions on top of the shell:
- `css/styles.css` loads AFTER `tokens.css` + `shell.css` and is both Manager's
  design system and its skin over the shell's `ps-` chrome (Mission-Control
  glassy rail, cyan active states). Shell canonical tokens (`--brand`,
  `--accent`, …) are defined in its `:root` alongside Manager's historical
  `--brand-a/b/c`.
- `js/app.js` owns the shell wiring (SECTIONS, topbar slots, theme configure)
  and pins Manager's own rail furniture (the `.rail-source` data-source
  indicator) into the shell rail.
- `js/ui.js` re-exports the shell primitives ($, el, escapeHtml, uuid) AND
  the shell dialog trio (toast/modal/sheet/confirmDialog/promptDialog, shell
  signatures — since v0.3.0) and keeps only Manager-specific helpers
  (trapFocus, mdToHtml, sparkline, drag-reorder, avatarColor, fmtCT…).
- `js/icons.js` re-exports the shell icon set and registers Manager-only
  glyphs via `registerIcons`.
- Storage keys are historical and must not change: `manager.theme`,
  `manager.rail.open` / `manager.rail.width`, `manager.whatsnew.seen`.

## Layout

```
index.html            Landing page (marketing; does NOT load the shell)
app/index.html        The app (tokens.css + shell.css + styles.css + js/app.js)
vendor/polecat-shell/ Shared fleet UI library (READ-ONLY — see above)
js/app.js             Boot, gate, routing, shell wiring, command palette
js/store.js           Relational localStorage layer (projects/releases/runs/…)
js/github.js          GitHub REST client for Fleet Ops (vault-backed token)
js/sources/           DataSource adapters (schema, local, supabase, turso)
js/sync.js            Remote mirror + write-through
js/views/*            One module per section, wired in app.js
js/changelog.js       Manager's own fleet-format changelog (see below)
js/access.js          ECDSA invite/admin gate (UX gating, not security)
.github/              deploy, ci, auto-revert (Guard main), self-improve
                      (dispatch-only fallback), stamp-changelog.mjs, smoke-test
```

## Rules for any agent working here

- **Read the platform's docs/FLEET-GUIDE.md first** (in kevinrhaas/
  polecat-platform) — it is the one-page authority on how work ships
  fleet-wide; the rules below are Manager's local restatement.
- **The changelog contract is sacred** (platform SHELL-API.md § contract):
  `js/changelog.js` stays fleet-format and parseable — Manager's own ingest and
  the polecat.live launcher read it live. New entries go on TOP with `ts: ''`;
  stamp with `node .github/stamp-changelog.mjs` before merge.
- **Smoke before ship**: `PW_EXECUTABLE=… node .github/smoke-test.mjs` —
  Playwright drives the real app, desktop + mobile widths, zero pageerrors.
  Mobile is a release gate. Smoke is ADVISORY in CI — never a deploy gate;
  auto-revert.yml ("Guard main") self-heals a broken main.
- Ship via `steward/<topic>` branch + PR; self-merge only when smoke is
  green ("merge is ship"); never push to main directly.
- Scheduled self-improvement runs centrally from polecat-platform's steward
  (see its docs/AUTOMATION.md); this repo's self-improve.yml is a
  dispatch-only fallback.
- One unit of high-quality work per run. No model identifiers in repo
  artifacts. Update ROADMAP.md in the same PR as the work it describes.

# Manager — roadmap

Mission control for a fleet of self-improving Claude Code projects. The hourly
self-improvement loop reads this file and builds the single highest-value item
in **Now**, then moves it to **Done** and adds follow-ups to **Next**.

Every run should be a **meaty, 30–45 minute chunk of work** — no tiny releases.
Track the run cadence in the app's Activity view: for every **5 feature runs**,
do a **sweep** (mode `polish`/`sweep`) across both the app and the public
landing page — graphics, motion, polish — and be reflective: update this roadmap
with new, ambitious, fun ideas.

---

## Now (build next, highest value first)

- [ ] **Custom metadata fields, first-class** — a schema editor so a project can
      carry arbitrary typed fields (text/number/url/select/date), surfaced in the
      library filters and the detail health panel. (Free-form key/value fields
      already exist on the project editor/detail page — this is about typing
      them and wiring them into filters/sort.)
- [ ] **Fleet-wide sync** — a "Sync all" action from the dashboard that runs
      changelog ingestion (see Done, below) across every project with a
      changelog URL, with a per-project result summary.

## Next (discovered / queued)

- [ ] Fleet health score + trend sparklines per project (release velocity).
- [ ] Bulk actions in the library (tag, set status, archive) with undo.
- [ ] Import/export the whole workspace as JSON; round-trip test in the suite.
- [ ] Per-project "notes" markdown scratchpad with autosave + history.
- [ ] Keyboard-first navigation everywhere; focus rings audited.
- [ ] Public site: an animated live "fleet" showcase driven by demo data.
- [ ] SQLite adapter behind the same Store interface (design already relational).
- [ ] Notification center for run failures / stale projects.
- [ ] Saved views: let a user save a *custom* filter+sort combo as a new named
      chip (today's saved views are a fixed, useful set — All/Live/Recent/
      Pinned — but they aren't user-definable yet).

## Done

- [x] **Live "what's new" ingestion** _(2026-07-02)_: a "Sync" button on the
      project page fetches a project's real `changelog.js` from its deployed
      site, safely parses the `CHANGELOG` array as data (never executes remote
      code), previews new/changed releases, and imports them into the releases
      table on confirmation. Cross-origin fetches blocked by CORS fail
      gracefully with a paste-the-file-contents fallback. Per-project changelog
      URL is editable (or guessed from the live site) and the health panel shows
      last-synced time.
- [x] **Command palette (⌘K)** _(previously shipped)_: fuzzy-search jump to any
      project, section, or action, with full keyboard navigation.
- [x] **Saved views** _(previously shipped)_: All / Live only / Recently active /
      Pinned chips in the projects library, persisted per-browser.
- [x] **v1 — Mission Control launch** _(initial build)_: landing page, token-gated
      app shell with rail nav, dashboard of project tiles (status, CT time, latest
      version, assessment, session link), projects library (filter/sort/search/
      pin/edit/add metadata), project detail with what's-new timeline, activity/
      cadence log, credentials (global + per-project), full docs, in-app what's-new
      panel (filter+sort+tracked-attribute customization), welcome tour, simple
      mode, history + undo, dark/light themes, admin invite minting, deploy +
      hourly self-improve workflows, and a Playwright battery.

---

## Principles

- **Vanilla only.** HTML/CSS/JS, no frameworks, no bundlers, no runtime npm deps.
- **Relational by design.** Every Store table is a keyed map of `{id, …, updatedAt}`
  rows so it maps cleanly onto SQLite later.
- **Delightful & humane.** Simple for beginners, powerful for pros. Motion with
  purpose. Mobile is a release gate, not an afterthought.
- **Never break the app.** `.github/smoke-test.mjs` must stay green; grow it with
  every user-visible feature.
- **A changelog entry** (`js/changelog.js`) for anything user-visible: newest at
  the top, bump `v`, `ts: ''` (the workflow stamps the real time), 1–4 `items`.

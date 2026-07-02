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

- [ ] Fleet health score + trend sparklines per project (release velocity).

## Next (discovered / queued)

- [ ] Generalize the mobile no-overflow smoke check (see Done, 2026-07-02) into
      a loop over every rail section at 320px, instead of the two spots this
      sweep happened to catch — cheap insurance against the next `.section-title`
      -shaped regression anywhere in the app.
- [ ] Audit modal/sheet content (sync-all list, custom-field editor, admin invite
      rows) for the same header-row-doesn't-wrap overflow risk on very narrow
      phones — this sweep fixed the two instances found by screenshot, but
      didn't exhaustively open every modal at 320px.
- [ ] Auto-sync retry/backoff signal — a project whose auto-sync keeps
      failing (CORS, 404, dead site) should surface that in its health panel
      instead of silently re-attempting every interval forever.
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
- [ ] Scheduled/automatic fleet sync (not just on-demand from the dashboard) —
      e.g. re-sync on app load if a project's last sync is >N hours old, with a
      quiet badge rather than a modal.
- [ ] Surface a "sync all" entry point from the projects library toolbar too,
      not just the dashboard quick action, for people who live in that view.
- [ ] "Promote to field" on a legacy free-form custom-field value — one click
      turns an untyped key entered before the schema existed into a proper
      typed field definition, prefilled from that value.
- [ ] Number-type custom fields as filter range sliders (min/max) in the
      library, to match the exact-match/contains filtering select/text fields
      already get.
- [ ] Reorderable custom fields (drag to set the `order` the schema already
      tracks) so the most-used ones surface first in the editor and health panel.

## Done

- [x] **Mobile overflow sweep** _(2026-07-02)_: found and fixed two real
      horizontal-scroll bugs by screenshotting the real app at phone widths
      (320–428px) rather than just reading the CSS. The public landing page's
      top nav and its invite-only CTA button clipped off-screen below ~480px;
      every app section's header (e.g. project detail's Sync/Force sync/Add
      release row) could overflow its container because `.section-title` never
      wrapped. Both are fixed at the shared-component level, and the smoke
      suite grew two checks — one per page — that fail if either regresses.
- [x] **Auto-sync & force-sync** _(2026-07-02)_: changelog ingestion effortless
      end to end. **Auto-sync** is a two-layer opt-in — a global switch +
      interval in Settings, plus a per-project toggle on that project's health
      panel — that quietly re-pulls a project's changelog on app open and on
      the configured cadence, banking new releases with no modal, and shows a
      "last auto-synced" time. **Force sync** is a full reconcile: it
      overwrites any release row that's drifted from the source (even if it
      was hand-edited afterward) and removes previously-synced releases no
      longer published upstream, behind an explicit confirm since it's
      deliberate and not undo-able in one step. Both sit next to the existing
      manual **Sync** button on the project page (plus a "Force sync" button)
      and the dashboard's **Sync all** (plus a new "Force sync all").
- [x] **Custom metadata fields, first-class** _(2026-07-02)_: a typed schema
      editor (Settings → Custom fields) lets you define fields — Text, Number,
      URL, Date, or a fixed Select list — once, shared across the whole fleet.
      The project editor renders the right control per type (including a
      "+ New field type" shortcut that defines one without leaving the modal),
      the project detail page formats values by type (clickable URLs, formatted
      dates, Select values as tags), and the projects library can filter by any
      field's value and sort by Number/Date fields alongside name/status/version.
      Legacy free-form values entered before the schema existed are preserved
      and stay editable.
- [x] **Fleet-wide sync** _(2026-07-02)_: a "Sync all" quick action on the
      dashboard runs the same live changelog ingestion as the per-project Sync
      button across every project that has a site or changelog URL, in one
      pass. A modal shows a live per-project checklist (fetching → new/updated
      counts or a failure reason) and a fleet-wide summary when done; projects
      with nothing to sync from are skipped and called out. A successful run
      is logged to Activity so the cadence log reflects bulk syncs too.
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

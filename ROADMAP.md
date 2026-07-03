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

- [ ] A notification center (see Next) for run failures / stale projects,
      built on top of the "Needs attention" rollup (2026-07-02) so both
      surfaces share the same underlying signal instead of drifting apart.

## Next (discovered / queued)

- [ ] Badge the rail's Dashboard nav item with the live "Needs attention"
      count (see Done, 2026-07-02) so a slipping project is visible even
      before you land on the dashboard — today the callout is silent until
      you're already looking at it.
- [ ] Let "Needs attention" thresholds be tuned from Settings, same spirit as
      the fleet health weighting (see Done, 2026-07-02) — today Slowing/Stale
      and the auto-sync fail threshold are fixed, not configurable per fleet.
- [ ] Persist a per-project override of the fleet health weighting (see Done,
      2026-07-02) for the rare project whose cadence is intentionally
      different from the fleet norm — today the weights are fleet-wide only.
- [ ] Make the auto-sync backoff cap and fail threshold (currently fixed
      constants in `js/ingest.js`) tunable from Settings → Auto-sync, same
      spirit as the health-score-weighting item just shipped (2026-07-02).
- [ ] Sweep the rest of the app's `display:flex;align-items:center` rows (this
      sweep, 2026-07-03) for the same wrap-then-center anti-pattern — anywhere
      a fixed-size icon/actions sibling sits next to a text column that *can*
      wrap to multiple lines is a candidate. Only three instances were found by
      hand this run; a real audit would grep every `.card`-with-inline-flex
      and every row class for the shape and check each at 320px.
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

- [x] **Mobile sweep: three squeezed-text rows fixed at 320px** _(2026-07-03)_:
      no fresh feature this run — a design sweep across the app and the public
      site, following up on the previous sweep's mobile-overflow work. Screen-
      shotting every rail section and every modal at 320px turned up three real
      (non-horizontal-scroll) bugs the earlier `scrollWidth`-based check
      couldn't catch: the "Sync all changelogs" modal squeezed project names
      down to unreadable fragments ("M..", "R..") when a status chip like
      "10 New, 1 Updated" claimed almost the whole row; and both the admin
      "Invites you've created" list and the Settings → Custom fields row
      vertically centered their edit/action buttons against the *whole* row,
      so a label wrapping to several lines made the buttons visually float in
      the middle of the text instead of beside its first line. All three are
      fixed with `flex-wrap` + top-alignment CSS (no HTML/behavior changes
      besides grouping the field-row buttons the same way sync-all/invite rows
      already did). The mobile no-overflow smoke check is now a loop over every
      rail section at 320px instead of the two one-off spots from last sweep,
      and three new checks pin down the exact regressions found here — each was
      verified to actually fail against the pre-fix code before being kept.
- [x] **"Needs attention" rollup** _(2026-07-02)_: the health score, release
      velocity, and auto-sync failing signal shipped earlier this cadence
      were only ever passive per-tile badges — easy to miss in a big grid. A
      new `Store.needsAttention()` centralizes the definition (health slipped
      to Slowing/Stale, or auto-sync failing past the threshold) and surfaces
      it in two places that share it exactly: a dashboard callout at the top
      of the fleet view listing every flagged project with its reason chips
      and one-click "Retry now" / "Open", and a new "Needs attention" saved
      view chip in the projects library that filters the table down to the
      same set. Nothing is flagged and the callout doesn't render when the
      fleet is healthy.
- [x] **Tunable fleet health weighting** _(2026-07-02)_: the three signals
      behind every project's health score — recency, release velocity, and
      status — are no longer fixed constants in `Store.healthScore()`. A new
      Settings → "Fleet health weighting" card exposes them as drag sliders;
      they're relative weights renormalized to always sum to 100, so any mix
      a user dials in behaves predictably, with a one-click reset back to the
      shipped default (40/40/20, chosen to reproduce the original fixed
      weighting exactly). `Store.healthScore()` now reads the live weights on
      every call, so dashboard tiles, the fleet health average, and each
      project's health panel all reflect a change immediately.
- [x] **Auto-sync retry/backoff signal** _(2026-07-02)_: a project whose
      auto-sync keeps failing (dead site, CORS, 404) now backs off instead of
      hammering the source every interval forever — each consecutive failure
      doubles the wait before the next attempt, capped at 8x, and any success
      resets it back to normal cadence. Once a project hits 2 failures in a
      row it surfaces as a "Failing ×N" badge with the error and a one-click
      "Retry now" in its health panel, plus a matching badge on its dashboard
      tile and a fleet-wide roll-up in Settings → Auto-sync so nothing fails
      silently in the background.
- [x] **Fleet health score + trend sparklines** _(2026-07-02)_: every project
      now carries a 0-100 health score — blending release recency, release
      velocity (releases in the last 90 days), and project status — mapped to
      five bands (Thriving/Healthy/Steady/Slowing/Stale) with a shared color
      and label so the badge always means the same thing everywhere it shows
      up. A tiny 10-week bar sparkline sits next to the score wherever it
      appears: on every dashboard tile, and in the project detail health
      panel (which also gets a dedicated "Health score" row). A new "Fleet
      health" stat card on the dashboard averages every project's score for
      an at-a-glance read on the whole fleet. Along the way, fixed a
      pre-existing dead CSS selector (`.tile .tfoot` vs. the actual
      `.tile-foot` class) that had silently left every dashboard tile's
      footer unstyled.
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

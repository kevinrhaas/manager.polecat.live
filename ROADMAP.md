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

- [ ] Persist a per-project override of the fleet health weighting (see Done,
      2026-07-02) for the rare project whose cadence is intentionally
      different from the fleet norm — today the weights are fleet-wide only.

## Next (discovered / queued)

- [ ] Now that both the health-score cutoff and the auto-sync fail threshold
      are fleet-wide (see Done, 2026-07-03), consider whether a per-project
      override belongs here too, for a project someone deliberately wants a
      lower/higher bar for (e.g. a "manual cadence" project that should never
      be flagged just for being slow) — same shape as the per-project health
      weighting idea above, just for the attention cutoffs instead.

- [ ] Now that dismissal exists (see Done, 2026-07-03), consider whether the
      rail badge should dim/deprioritize (rather than disappear) once a user
      has opened the popover or dashboard this session but hasn't dismissed
      anything — a middle ground between "hot" and "gone" for the moment
      right after you've *seen* something but before you've acted on it.
- [ ] Group the notification popover by reason (health vs. sync) once the
      list regularly has more than a handful of rows — right now it's a flat
      list sorted worst-score-first, fine at fleet scale today but won't
      stay scannable if the fleet grows a lot.
- [ ] Make the auto-sync backoff cap (currently a fixed constant,
      `AUTO_SYNC_BACKOFF_CAP` in `js/ingest.js`) tunable from Settings →
      Auto-sync, same spirit as the fail threshold just shipped (2026-07-03,
      see Done) — the fail threshold that decides *when* a project counts as
      "failing" is now tunable, but how much its retry cadence backs off
      while it stays that way still isn't.
- [ ] One more pass on the wrap-then-center anti-pattern: this sweep
      (2026-07-03, see Done) grepped every `align-items:center` rule in
      `css/styles.css` plus every inline-styled row in `js/views/*.js` and
      fixed the three real hits, but a handful of header-shaped rows
      (`.modal-head`, `.sheet-head`, `.notif-pop-head`) were skipped because
      their titles are short static strings today — if any of those ever grow
      a dynamic, potentially-long title, re-check them at 320px too.
- [ ] Bulk actions in the library (tag, set status, archive) with undo.
- [ ] Import/export the whole workspace as JSON; round-trip test in the suite.
- [ ] Per-project "notes" markdown scratchpad with autosave + history.
- [ ] Keyboard-first navigation everywhere; focus rings audited.
- [ ] Public site: an animated live "fleet" showcase driven by demo data.
- [ ] SQLite adapter behind the same Store interface (design already relational).
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
- [ ] Auto-expire old dismissals: `Store.dismissals` rows for a project that
      later becomes healthy (and so drops out of `needsAttention()` entirely)
      are harmless but never garbage-collected — a low-priority cleanup, not
      a correctness issue, since `isAttentionDismissed()` only ever matches a
      row that's still actually flagged.

## Done

- [x] **Sweep: a real horizontal-overflow bug + two floating-icon alignment
      bugs, hunted by grepping every `align-items:center` row** _(2026-07-03)_:
      following up the previous sweep's flex-wrap fixes to `.field-row` and
      `.invite-row`, this pass grepped every `align-items:center` rule in
      `css/styles.css` and every inline-flex row in `js/views/*.js` looking for
      the same shape (a fixed-size icon/actions sibling next to a text column
      that can wrap) and verified each candidate at 320px with real long
      content rather than reading the CSS and guessing. Found and fixed three:
      (1) the credentials row was the worst — a long, unbroken key name (real
      env vars like `NEXT_PUBLIC_SUPABASE_ANON_KEY` routinely are) forced the
      *entire row* wider than the viewport, pushing Reveal/Copy/Edit
      completely off-screen; fixed by giving `.mono` `overflow-wrap:anywhere`
      (so unbreakable tokens wrap instead of forcing width) and giving the
      credential row its own `.cred-row`/`.cred-row-mid`/`.cred-row-actions`
      classes (mirroring `.field-row`) so actions wrap onto their own line
      when needed. (2) Settings toggle rows (`.opt-row`, e.g. "Simple mode")
      and (3) the Activity run log (`.run-row`) both centered their
      switch/icon against the *whole* multi-line wrapped description or note
      instead of aligning it with the first line — both fixed with
      `align-items:flex-start`, same fix shape as last sweep's field/invite
      rows. All three were verified to actually fail against the pre-fix code
      before being kept, and the smoke suite grew a check per bug that seeds
      real long content (a long env-var key, a long run note) and asserts the
      specific failure mode (overflow / floating mid-column) is gone.
- [x] **Tunable "Needs attention" thresholds** _(2026-07-03)_: the health-score
      cutoff and the auto-sync fail count behind `Store.needsAttention()` were
      fixed constants — Slowing/Stale (score below the Steady band's floor of
      35) and two consecutive failures, respectively. A new Settings →
      "Needs attention" card (sitting right under the fleet health weighting
      card it mirrors in spirit) exposes both as drag sliders — health score
      cutoff 1–100, auto-sync fails 1–10 — with a live "N of M projects
      flagged right now" readout and a one-click reset to the shipped
      defaults. `Store.attentionThresholds()`/`setAttentionThresholds()` join
      `healthWeights()` as the tunable-settings pattern; `needsAttention()`
      now reads the live thresholds on every call, so the bell, the rail
      badge, the dashboard callout, and the library's saved view all move
      together the instant a slider changes — same shared-definition
      guarantee the earlier "Needs attention" rollup shipped with. The
      per-project "Failing ×N" badges (project tile, health panel, and the
      Settings → Auto-sync roll-up) now read the same tunable fail threshold
      instead of a separate hardcoded constant, so a project stops being
      called "failing" in one place and not another.
- [x] **Dismiss a "Needs attention" notification** _(2026-07-03)_: the bell,
      rail badge, and dashboard callout all mirrored the live
      `Store.needsAttention()` set with no per-item read state, so a problem
      you'd already seen kept re-surfacing everywhere until it was actually
      fixed. Every row (`attentionRow`, shared by the bell popover and the
      dashboard callout) now has a Dismiss action; a new `dismissals` table
      records it against the *exact signature* of the reasons it was raised
      for (e.g. `health:Slowing · 42/100`), not just the project id — so
      dismissing a merely-Slowing project doesn't swallow a genuinely new or
      worse problem that shows up later (say, its auto-sync starting to fail
      too), which resurfaces immediately because the signature no longer
      matches. `Store.needsAttentionActive()` (needsAttention() minus
      current-signature dismissals) now drives the bell badge, the rail
      badge, and the dashboard callout; the library's "Needs attention" saved
      view deliberately keeps showing the full raw set, dismissed or not,
      since it's a query someone navigated to on purpose rather than a
      passive notification. Nothing is thrown away — a "N dismissed" link on
      both the dashboard callout and the bell popover opens a review modal to
      restore any of them, and dismissing itself shows an instant "Undo"
      toast.
- [x] **Rail badges the Dashboard nav item with the live "Needs attention"
      count** _(2026-07-03)_: the bell already proved the shared-signal
      pattern, but it's only visible once you look at the topbar — the rail
      itself said nothing. `shell.js`'s `setBadge` helper (scaffolded but
      never wired up) now drives a badge on the Dashboard rail item wired to
      the same `Store.needsAttention()` count as the bell and dashboard
      callout, kept in sync from one `refreshAttentionBadges()` call in
      `app.js`. The harder part was the rail's collapsed (icon-only) state,
      which is the default: a numeric pill has no room next to a hidden
      label, so collapsed mode shows a small danger-colored dot pinned to the
      icon's corner instead, and the full "N" pill appears once the rail is
      opened — both states pull from the same badge element and the same
      count, verified in both themes and covered by a new smoke check that
      exercises the badge expanded and collapsed.
- [x] **Notification center** _(2026-07-03)_: a bell in the topbar surfaces
      `Store.needsAttention()` from anywhere in the app, not just the
      dashboard — a live badge count (hidden when the fleet is healthy) and
      a click-through popover that reuses the exact same row renderer as the
      dashboard's "Needs attention" callout (`attentionRow`, now exported
      from `home.js`), so all three surfaces — bell, dashboard callout,
      library saved view — can never drift out of sync with each other or
      with `Store.needsAttention()` itself. Each row keeps its one-click
      "Retry now" (for a failing auto-sync) and jump-to-project, plus an
      "Open dashboard" footer shortcut to the fuller view, and the popover
      shows a calm "All clear" state rather than rendering empty. The
      popover anchors under the bell but clamps its own left edge to the
      viewport — a naive right-align broke on mobile, where the bell isn't
      the rightmost topbar button (theme + add-project sit further right),
      pushing the box off-screen to the left; verified the bug reproduced
      against the old positioning before fixing it, and a new smoke check
      pins the regression down at 320px.
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

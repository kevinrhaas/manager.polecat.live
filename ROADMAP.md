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

- [ ] Pick the next highest-value item from **Next** below — a **docs sweep**
      just closed the biggest gap in the in-app documentation (health scoring/
      weighting/notifications had zero coverage, see Done, 2026-07-04), on top
      of the fleet-wide **Tags manager**, the keyboard-focus-ring audit, and
      the public "recent activity" ticker (all Done, 2026-07-04).

## Next (discovered / queued)

- [x] **Fleet Ops in Manager** (shipped 2026-07-15) — a steward panel that
      toggles the platform's focus roster and dispatches/observes steward runs
      through the GitHub API using a credential from the vault, with recent-run
      history, open steward PRs, and sweep findings fleet-wide + on each
      project page. Follow-ons shipped 2026-07-15: live auto-refresh of the
      runs list (token-gated, visibility-aware) and per-run app attribution
      (the platform steward now titles runs with their target app). Still
      queued: roster edits via PR (instead of direct data commit) if the
      platform ever asks for it. Also shipped 2026-07-15: the Fleet safety
      nets strip (janitor + sweep last outcomes) and live check dots on open
      steward PRs. Also shipped 2026-07-15: red steward PRs + open sweep
      findings now feed the Needs-attention pipeline (bell, rail badge,
      dashboard chips, signature-scoped dismissals) via an in-memory
      steward-signals overlay (js/steward-signals.js).

- [ ] Polecat Shell follow-ups (migrated 2026-07-15 — the app frame, theme,
      icons and What's-New now come from `vendor/polecat-shell/`, READ-ONLY):
      (a) adopt the shell's modal/confirmDialog/toast signatures when shell v2
      lands and delete Manager's local trio in `js/ui.js`; (b) consider the
      shell settings framework (`defineSettings`) for the Settings view;
      (c) DONE 2026-07-15 (shell v0.2.0 vendored): `:focus-visible` rings for
      `.ps-rail-brand`/`.ps-rail-toggle` and a badge `tone` option on
      `setBadge` — both upstreamed to the platform and Manager's local
      compensations deleted.

- [ ] Data sources (see Done, 2026-07-08) — the follow-on queue, roughly in
      value order: (a) **validate the live remote adapters** end to end against
      real Turso/Supabase/Firebase projects and fix whatever the specs got
      subtly wrong (this build couldn't reach a real DB); (b) **per-row
      delta sync** instead of the current full-snapshot write-through — fine
      for a metadata-sized fleet today, but a real cost once a workspace grows
      or two browsers write concurrently (needs updatedAt-based merge +
      conflict handling, not last-write-wins); (c) a lightweight **poll/pull**
      so a second connected browser sees the first's changes without a manual
      reconnect; (d) **schema migrations** across `SCHEMA_VERSION` bumps (probe
      already reads the version — provision/adopt should reconcile an older
      remote); (e) **users + per-user access** (the user flagged this as
      eventual — RLS on Supabase, auth tokens on Firebase/Turso, and moving the
      connection off per-browser localStorage); (f) more backends now that the
      adapter contract is proven (Neon, PlanetScale, Cloudflare D1, Postgres-
      over-HTTP). Hold (b)-(e) until the adapters are validated against real
      databases — don't build merge/migration machinery on unproven transport.
- [x] Docs sweep for the platform era (shipped 2026-07-15) — new "Fleet Ops &
      the steward" section (roster, janitor, dispatches, vault token, steward
      attention signals) + drift fixes across Getting started / Activity /
      Credentials / Releases / Health for the centralized-steward model.

- [ ] The new "Health, weighting & notifications" docs section (see Done,
      2026-07-04) was written by reading the real code (`store.js`'s
      `HEALTH_BANDS`, `settings.js`'s card labels, `project.js`'s override
      rows) rather than guessing, but it's still hand-maintained prose —
      the same drift risk every other hand-written doc section already
      carries (nothing re-checks it against the code). Worth revisiting only
      if the health/weighting system's labels or bands actually change and
      the docs page isn't updated in the same pass.
- [ ] Auditing docs.js for this sweep only checked the health/notifications
      area for missing coverage (the biggest, most conspicuous gap — a whole
      feature area with zero mentions). Worth a similar pass over the other
      sections against the full feature list in ROADMAP's Done history if a
      future sweep has spare time — e.g. the "Recently deleted" tray, Copy/
      Export, and Merge JSON's update/remove opt-ins are covered, but this
      wasn't an exhaustive line-by-line audit of every shipped feature.
- [ ] The new Tags manager (see Done, 2026-07-04) has no reorder of its own —
      unlike Custom fields or saved views, tag rows are always sorted by
      usage count (ties broken alphabetically), with no grip handle or
      up/down arrows. Deliberate: there's no per-tag "display position"
      anywhere else in the app for an order to drive (tags render as a flat,
      unordered chip list on every project row and detail page), so a manual
      order would have nothing to feed into. Worth revisiting only if tags
      ever gain their own ordered rendering somewhere.
- [ ] The Tags manager's "Remove from every project" (see Done, 2026-07-04)
      has no confirm dialog — consistent with the library's existing bulk
      "Remove tag" action, which also just relies on the Undo toast rather
      than an "are you sure" gate, since a tag removal is trivially reversible
      and low-stakes compared to, say, deleting a project. Worth revisiting
      if removing a tag fleet-wide (rather than from a hand-picked selection)
      ever turns out to surprise someone who didn't expect it to reach every
      project, not just the ones they were looking at.

- [ ] The new "recent activity" ticker (see Done, 2026-07-04) always shows the
      last 5 entries regardless of viewport — on a wide desktop screen all 5
      chips can fit with nothing left to scroll, which is fine (the edge-fade
      mask is a no-op when there's no overflow), but the auto-drift itself
      only ever engages when `scrollWidth > clientWidth`. Worth widening to
      the last 8-10 entries if the ticker ever feels too static on very wide
      monitors; left at 5 since that's what actually overflows the strip's
      900px cap on every viewport tested so far.
- [ ] The rail's new focus ring (see Done, 2026-07-04) is a plain
      `box-shadow` swap on `:focus-visible`, same as every other button in the
      app — but the *collapsed* rail (`#rail:not(.open)`) squeezes each
      `.rail-item` down to just its icon with no visible label, so a
      keyboard user tabbing through a collapsed rail sees a ring around a
      bare icon with no text nearby confirming which section it is (sighted
      users get this for free once they open the rail; a screen reader user
      already gets the real `title`/label via markup, so this is a purely
      visual gap). Worth a small on-focus tooltip or auto-expand-on-focus if
      that ambiguity is ever reported as real friction — no evidence yet
      that it is, since the collapsed rail already carries a `title`
      attribute that most browsers show on hover/focus.

- [ ] The new fleet-showcase status pulse + staggered entrance (see Done,
      2026-07-04) hardcodes its cascade delays and dot-pulse offsets per
      `nth-child(1)` through `nth-child(6)` in `css/landing.css` — exactly
      matching today's six fleet chips. If a seventh project ever joins the
      showcase, that chip would fall out of the cascade (default `0s` delay,
      popping in with the rest of the "in" transition instead of trailing
      it) and its status dot would pulse with no offset assigned. Fine today
      since the fleet is a small, known, hand-edited set of six cards; worth
      generalizing to a CSS custom property set from a tiny inline `style`
      (or an `:nth-child` formula) if the fleet showcase ever grows past six.
- [ ] The new fleet-showcase status pulse (see Done, 2026-07-04) only
      animates on `is-live`/`is-active` — the same latent gap as the item
      below (no `is-building`/`is-paused`/`is-archived` variant exists yet
      for either the color or the pulse), so a future third status would
      need both added together in one pass rather than two.
- [ ] The new fleet-showcase status colors (see Done, 2026-07-04) only handle
      the two statuses actually in use today (`live`/`active`) — if a seeded
      fleet project's real status ever legitimately becomes `building`,
      `paused`, or `archived`, `.fchip .st` would need a matching
      `is-building`/`is-paused`/`is-archived` class + color added alongside
      `is-live`/`is-active` (mirroring `js/store.js`'s `STATUSES` table)
      rather than silently falling back to the plain `--text-2` base color.
- [ ] The new default-saved-view pin (see Done, 2026-07-04) lives only in the
      "Reorder saved views" modal — a saved-view chip has no room of its own
      for a third button beyond apply/delete. Fine today since that modal is
      already the one-stop shop for saved-view housekeeping, but worth a
      one-click "pin as default" directly on the chip (e.g. a small overflow
      menu) if reaching the modal just to flip the flag is ever reported as
      friction.
- [ ] The default saved view (see Done, 2026-07-04) is applied once, on a
      fresh navigation into Projects — deliberately not reapplied on every
      reactive re-render while you're already there, so it can never yank an
      active filter out from under you mid-visit. One consequence: deleting
      the currently-default view while sitting on the Projects page doesn't
      restore the plain "last used" filter until you navigate away and back.
      Low priority — deleting your own default view is a rare, deliberate
      action, and the very next visit self-corrects.
- [ ] The saved-views reorder modal (see Done, 2026-07-04) only reorders the
      *custom*, user-saved chips — the five built-in ones (All/Live/Recent/
      Pinned/Needs attention) are still a fixed leading block the custom
      chips always trail. Reasonable today (the built-ins are a stable,
      well-known set), but worth revisiting if someone wants their most-used
      custom view to sit before a built-in they rarely touch.
- [ ] The new custom-field reorder drag handle (see Done, 2026-07-04) uses
      native HTML5 drag-and-drop, which has patchy touch support on real
      mobile browsers — the up/down arrows are the actual mobile-safe path
      today, and they fully work standalone, but a phone user reaching
      specifically for the grip handle may find it inert. Worth a
      pointer-events-based custom drag implementation (mirroring
      `js/shell.js`'s rail-resize mousedown/touch handling) if that gap ever
      gets reported in practice; low priority since the arrows already cover
      the same outcome end to end.
- [ ] Now that a Number-type custom field gets a real dual-handle range-slider
      filter (see Done, 2026-07-04), its bounds (the slider's min/max travel)
      are computed fresh from the live fleet's actual data every time the
      field is picked in the toolbar — if a saved view captured a specific
      `fieldMin`/`fieldMax` and the underlying data's real range later shifts
      (e.g. someone edits a project's value to a new extreme), the saved
      view's numbers still apply as a filter correctly, but the slider's
      visual travel will have quietly widened or narrowed around them. Not a
      correctness bug (the stored numbers are still exact), just a cosmetic
      "the handles aren't quite where you last left them" — worth revisiting
      only if that mismatch actually confuses someone in practice.
- [ ] The new range-slider filter's "every value is identical" edge case
      (see Done, 2026-07-04) synthesizes a 1-wide fake span (`hi = lo+1`) so
      the two handles never collapse into an unusable zero-width slider —
      reasonable for now (rare in practice: it only triggers when literally
      every project sharing that field has the exact same number), but worth
      a small "only one value in use" note near the readout if a fleet ever
      grows enough number-type fields that this becomes a regular sight
      rather than an edge case.
- [ ] Now that Manager's own landing-page version copy self-corrects from
      `js/changelog.js` (see Done, 2026-07-04), the other five fleet chips on
      the same page (Relay, Games, Polecat, Polecat App, Solution Eng.) are
      still hand-typed strings that will drift the same way Manager's did —
      left alone deliberately, since "keep the seed honest" means those
      numbers can only be updated from real verified evidence about someone
      else's repo, not synced automatically the way Manager's self-knowledge
      can be. Worth a lightweight periodic "does this still match reality"
      prompt (or a comment marker with the date last verified) if the fleet
      grows enough that a chip going stale for months becomes likely to slip
      past notice.
- [ ] The public landing page has no equivalent of the in-app "what's new"
      panel's full history — the hero banner (see Done, 2026-07-04) only ever
      shows the single latest entry. A fun, low-risk idea for a future sweep:
      a small "recent activity" ticker under the hero (last 3-5 entries,
      auto-rotating or a tiny scrollable strip) using the same
      `js/changelog.js` import, so a first-time visitor gets a feel for the
      hourly cadence before ever unlocking the app.
- [ ] The new "Recently deleted" tray (see Done, 2026-07-04) only reaches as
      far back as the 40-op undo history (`HIST_MAX` in `store.js`) — a
      project deleted long enough ago to have aged out of that stack has no
      recovery path short of a JSON backup. Worth a dedicated persisted "tomb"
      log (independent of the undo stack's size, maybe capped by count or age
      instead) if that gap ever bites someone in practice; today's version
      piggybacks on the existing history stack specifically because it needed
      zero new persistence to ship.
- [ ] "Recently deleted" only surfaces `projects` (with their cascaded
      releases/credentials riding along) — a `fieldDefs`/`savedViews` row
      deleted on its own has no equivalent tray, only the single-shot Undo
      toast. Low priority: those tables don't cascade anything and are edited
      far less often than projects, so the "oops, a few actions later" gap
      the tray closes for projects is much rarer for them.
- [ ] Now that milestones + a recommended "stable release point" exist (see
      Done, 2026-07-04), the next natural steps: (a) a fleet-wide **Milestones**
      view/row on the dashboard or Releases feed that lists just the marked
      stable points across every project, as a "here's where each thing last
      settled" board; (b) fold milestone-density into the health score or the
      "needs attention" heuristic (a project that shipped a burst then a
      stabilizing tail but was never milestone-marked could nudge a gentle
      "want to mark v_N_?"); (c) let the recommendation look back further than
      the 120-day relevance window when a project is dormant, so an archived
      project still shows its last real release point. Hold until the current
      single-project callout has been exercised for a few cadences — don't
      over-build the heuristic before real release histories stress it.
- [ ] Now that bulk "remove tag" exists (see Done, 2026-07-04) alongside bulk
      "add tag", the two prompts share almost no code — Add tag is a bare
      text input (any spelling is valid, it's creating a tag), Remove tag is
      a `<select>` scoped to the checked projects' existing tags (nothing to
      mistype since it's only ever removing what's already there). Worth
      revisiting only if a third tag-shaped bulk action shows up and the
      duplication actually starts to hurt — today the two modals are ~15
      lines apiece and reads as clearer kept separate than forced through one
      shared "tag modal" with a mode flag.
- [ ] Now that per-project notes exist (see Done, 2026-07-04), the merge-review
      diff for an updated `projects` row would show a raw `notesHistory` array
      as `JSON.stringify(...)` (truncated to 70 chars) same as any other
      field — fine today since notes are local scratch text nobody expects to
      diff row-by-row across browsers, but worth a dedicated "N notes edits"
      summary in `mergeRowDiffHtml` (settings.js) if someone actually merges
      workspaces with divergent notes in practice.
- [ ] The notes scratchpad's revision trail (see Done, 2026-07-04) is capped
      at 20 snapshots per project with no way to see how many were dropped —
      worth a quiet "and N older versions were trimmed" line in the History
      modal if anyone actually fills a project's notes with enough edit
      churn to hit the cap.
- [ ] Now that Manager syncs its own real `CHANGELOG` into its releases (see
      Done, 2026-07-04), its per-project auto-sync toggle is still off by
      default like every other project's — but Manager is the one project
      where "auto-sync" carries zero CORS/network risk (it's a same-process
      local import, not a fetch), so there's no real reason not to also flip
      Manager's `autoSync` on in the seed for fresh workspaces. Left off this
      pass since `syncOwnChangelog()` on every boot already keeps it current
      regardless of the toggle; only worth it if the per-project auto-sync
      badge/UI itself is expected to reflect Manager's sync state too.
- [ ] The new JSON/RSS export (see Done, 2026-07-04) is a manually-triggered
      *snapshot* download, not a live subscribable URL — there's no server to
      host a stable feed endpoint on a static GitHub Pages site. Worth
      revisiting if a real hosting option shows up (e.g. a tiny serverless
      function or a scheduled GitHub Action committing a refreshed
      `releases.xml`/`releases.json` into the repo itself) so a feed reader
      could point at a URL instead of someone re-downloading by hand.
- [ ] The combined JSON/RSS export (see Done, 2026-07-04) always covers a
      fixed last-30-days window across every project, deliberately ignoring
      the toolbar's project/kind/range filters (so it reads as a stable
      "what shipped across the suite" snapshot rather than whatever happened
      to be dialed in at export time) — worth a "match current filters"
      opt-in toggle in the export modal if someone wants a narrower feed
      (e.g. just one project's releases) piped into a reader instead.
- [ ] The Releases feed's "Digest" density mode (see Done, 2026-07-03) always
      truncates a group's preview to its first 3 releases ("+N more") — worth
      a "remembers per-session which groups you expanded" tweak if a heavy
      user reports re-expanding the same handful of projects/days repeatedly
      after every filter change; today every `rerender()` rebuilds fresh
      `<details>` elements so expansion state doesn't survive a filter tweak,
      which reads as reasonable default behavior with no evidence yet it's a
      real annoyance.
- [ ] "Jump to date" (see Done, 2026-07-03) only offers dates present in the
      *currently filtered* set — reasonable (jumping to a date with nothing
      to show would be a dead click), but worth revisiting if someone wants
      to jump across an active project/kind filter to a date that filter
      hides, e.g. a small "(disabled — no matches under current filter)"
      option instead of simply omitting the date.
- [ ] The new fleet-wide "since you last looked" unread marker (see Done,
      2026-07-03) is deliberately coarse — one `seenTs` for the whole feed,
      re-armed only on an actual rail-click navigation into Releases (not on
      every live re-render while already there), mirroring how
      `js/views/whatsnew.js` treats "seen" as a single version number rather
      than per-entry read state. Worth revisiting only if someone wants
      per-project or per-release read-tracking (e.g. "mark this one as read"
      independent of the rest) — no evidence yet that the coarse version
      isn't enough.
- [ ] The "by project" grouping (see Done, 2026-07-03) orders project buckets
      by their most recent release, same spirit as the existing "who shipped"
      chip row's count-desc order — if the feed ever grows enough projects
      that scanning becomes a chore, consider letting the grouped view also
      sort alphabetically as a secondary option, the same way the projects
      library lets you pick a sort field rather than only one fixed order.

- [ ] The merge-review's new "also remove" opt-in (see Done, 2026-07-03) is
      per-merge, not per-table — if a file is a full export of `projects` but
      only a partial export of, say, `credentials`, checking the one box
      would delete local credentials that were never meant to be removed.
      Today's copy ("remove N rows that exist here but aren't in the file")
      and the full per-table review list are the mitigation, but a per-table
      set of checkboxes (rather than one global one) would be safer for
      someone merging files that mix a full export of one table with a
      partial export of another — worth it if that scenario shows up in
      practice, low priority since the review list already makes the blast
      radius visible before committing.
- [ ] The merge-update diff (see Done, 2026-07-03) compares top-level fields
      with a plain `JSON.stringify` per field for display, which is only a
      display nicety — `Store._rowsDiffer()` (the thing that actually decides
      whether a row is "different" at all) already does the key-order-safe
      compare. Worth switching the display diff to the same stable-stringify
      helper if a false "changed" ever shows up in practice (e.g. two
      differently-ordered nested objects inside one field, like a project's
      `fields` map) — low priority since it would show a spurious diff line,
      never a wrong merge decision.
- [ ] The merge-review list's per-row layout fix (two flex children — a tag
      chip plus one wrapper span — see Done, 2026-07-03) is the same
      "anonymous flex item" trap the old `.sync-preview` markup had been
      quietly carrying since the original Sync-changelog modal shipped; worth
      grepping for any other `display:flex` list item built from raw
      `el(...,{html:...})` strings mixing bare text with inline elements
      (rather than a single wrapping child) in case the same squeeze bug is
      hiding somewhere it hasn't been triggered by long content yet.
- [ ] The new scroll-direction fade (see Done, 2026-07-03) only wired up
      `.lib-table` — the docs sidebar's mobile table-of-contents strip
      (`.docs-toc`, `overflow-x:auto` under 760px) has the exact same
      "scrolls but gives no hint" shape and would benefit from the same
      `can-scroll-l`/`can-scroll-r` treatment if a third horizontally-
      scrolling strip shows up, worth promoting the pair of pseudo-elements
      + `ResizeObserver` snippet into a tiny shared helper rather than a
      third hand-copy.
- [ ] Now that bulk delete exists (see Done, 2026-07-03), consider a
      lightweight "Recently deleted" tray (last N removed projects, past the
      single-slot undo stack) — undo covers the "oops, right after" case, but
      once a few more actions have happened since a bulk delete, a project is
      gone with no path back short of restoring a JSON export.
- [ ] Now that dismissal exists (see Done, 2026-07-03), consider whether the
      rail badge should dim/deprioritize (rather than disappear) once a user
      has opened the popover or dashboard this session but hasn't dismissed
      anything — a middle ground between "hot" and "gone" for the moment
      right after you've *seen* something but before you've acted on it.
- [ ] Group the notification popover by reason (health vs. sync) once the
      list regularly has more than a handful of rows — right now it's a flat
      list sorted worst-score-first, fine at fleet scale today but won't
      stay scannable if the fleet grows a lot.
- [ ] One more pass on the wrap-then-center anti-pattern: this sweep
      (2026-07-03, see Done) grepped every `align-items:center` rule in
      `css/styles.css` plus every inline-styled row in `js/views/*.js` and
      fixed the three real hits, but a handful of header-shaped rows
      (`.modal-head`, `.sheet-head`, `.notif-pop-head`) were skipped because
      their titles are short static strings today — if any of those ever grow
      a dynamic, potentially-long title, re-check them at 320px too.
- [ ] SQLite adapter behind the same Store interface (design already relational).
- [ ] Saved views only capture status/sort/dir/field — worth revisiting if a
      free-text search (`q`) ever becomes something worth pinning to a saved
      view too (e.g. "everything mentioning 'webrtc'"); left out deliberately
      for now since search reads as transient, matching the built-in chips'
      same choice not to touch it.
- [ ] Auto-expire old dismissals: `Store.dismissals` rows for a project that
      later becomes healthy (and so drops out of `needsAttention()` entirely)
      are harmless but never garbage-collected — a low-priority cleanup, not
      a correctness issue, since `isAttentionDismissed()` only ever matches a
      row that's still actually flagged.

## Done

- [x] **Pluggable data sources — connect a real database** _(2026-07-08)_:
      the whole workspace can now live in a remote database instead of only
      this browser, so the same data is reachable from anywhere and can back
      dashboards / other Polecat apps. Built as a small `DataSource` contract
      (`js/sources/*`: probe / provision / summarize / drop / load / save) with
      a shared, backend-neutral schema (`schema.js` — relational tables +
      promoted queryable columns + a `polecat_meta` marker so probe can
      classify empty / ours / foreign / another-app). Adapters: **Local**
      (localStorage, the default, shown in the rail), **Turso** (SQLite over
      HTTP — full DDL+CRUD from the browser, the reference remote), and
      **Supabase** (Postgres/PostgREST — data plane native, provisioning via a
      one-time paste-in SQL script since the anon key can't DDL) + **Firebase**
      (Firestore) scaffolds. `sync.js` is the connection manager + write-through
      mirror: the app keeps its synchronous local Store, and every mutation is
      debounced up to the active remote; reconnecting from another browser
      pulls it back. Admin → Data source drives the connect wizard (inspect →
      empty:create+push / ours:summarize+adopt / foreign:warn+optional drop);
      the rail chip shows local / connecting / connected / syncing / error.
      Credentials are per-browser localStorage (flagged in the UI). Local +
      the abstraction + the full connect lifecycle are covered by smoke
      (incl. an injected in-memory adapter); the live remote adapters are
      written to each backend's HTTP/REST spec and want real credentials to
      validate end to end.
- [x] **Milestones + a recommended "stable release point"** _(2026-07-04)_:
      answering "when/which release is a good, complete stopping point?" —
      raised directly by the user. Two halves. (1) **Recommendation**:
      `Store.recommendedMilestone(projectId)` scores each release over the
      shape of the history — a run of shipped features, then a stabilizing
      tail of polish/fix releases, a quiet pause before the next change, a
      round version number, and recency — gated by a "candidate" signal so a
      project that just ships features non-stop gets *no* false milestone, and
      capped at a 120-day relevance window. Returns `{release, score(0..10),
      reasons[]}` or null. The project page renders it as a "Recommended
      release point" callout above the what's-new timeline, with a confidence
      chip, the reasons, a "Why this one?" explainer, and a one-click "Mark as
      milestone". (2) **Marking**: `Store.setMilestone(releaseId, on, label)`
      flags any release (optional label like "1.0" / "Public launch"); a 🚩
      button on every timeline row toggles it, marked releases carry an
      `.ms-badge` everywhere they show (project timeline + fleet Releases
      feed), and the Releases feed gained a **Milestones** filter chip. Pure
      heuristic over `(kind, v, ts)` — no network, no stored derivation.
- [x] **Sweep: Docs cover health scoring, weighting & notifications; landing
      page catches up on its own version** _(2026-07-04)_: a design & feature
      sweep across the app and the public site, following the "keep it lean,
      find real gaps" brief. The single biggest find: the in-app **Docs**
      page had complete sections for the dashboard, library, releases,
      credentials, and cadence — but **zero mention** of the health-score
      system, even though it's one of the most built-out feature areas in the
      app (five score bands, tunable fleet-wide *and* per-project weighting,
      tunable "needs attention" thresholds with their own per-project
      override, a tunable auto-sync backoff cap, the notification bell, the
      rail badge, and dismiss/restore). Someone reading the docs end to end
      would never learn any of it existed. A new **"Health, weighting &
      notifications"** doc section (right after "The dashboard", before
      "Projects & the library" — where health scores first appear) explains
      the five bands (Thriving → Stale) and what drives them, where to tune
      the weighting fleet-wide vs. per-project, what "Needs attention" means
      and where its two cutoffs live, and how the bell/rail badge/dashboard
      callout share one signal plus how Dismiss works. Written from the real
      code (`store.js`'s `HEALTH_BANDS`, `settings.js`'s card labels,
      `project.js`'s override-row copy), not guessed. Along the way, the
      library's own doc paragraph was missing the "Needs attention" chip from
      its list of saved-view presets (the app has five built-in chips; the
      docs only ever named four) — added. Separately, chasing "keep it
      honest" turned up a regression of the exact bug fixed at v43: the
      landing page's hero banner, activity ticker, and fleet card had drifted
      back to a stale hand-typed "v43" in their baked-in fallback markup (the
      live JS overwrites them correctly on every page load, so the real
      behavior was never wrong — only the no-JS fallback text, and the
      activity ticker's 5 baked-in rows, had gone stale again since that fix).
      Corrected both to the real latest version and entries. One new smoke
      check drives the real Docs page end to end: confirms the new section's
      text actually covers the health bands/weighting/attention/dismiss
      vocabulary, and that clicking its table-of-contents link scrolls to it
      and marks it active (the existing scroll-spy).

- [x] **A fleet-wide "Tags" manager in Settings** _(2026-07-04)_: tags were a
      genuinely useful free-form field on every project (the search box
      already matched against them, bulk add/remove tag already existed in
      the library), but the tag *vocabulary itself* had no home — a typo'd
      tag, an inconsistent spelling ("webrtc" vs "WebRTC"), or one nobody uses
      anymore could only be fixed project-by-project in the editor, with no
      way to even see the full list of tags in use across the fleet. A new
      **Tags** card in Settings (right below Custom fields, the other
      fleet-wide metadata schema) lists every distinct tag with how many
      projects carry it, sorted most-used first. Each row gets three actions:
      a **search icon** that jumps straight to the library pre-filtered to
      that tag (via a new `setLibrarySearch()` in `js/views/projects.js`,
      writing the same `manager.lib.view` state the search box itself reads —
      zero new filtering logic, since tags already flow through the existing
      "contains" search), a **rename** that updates the tag on every project
      that carries it in one step, and a **remove** that strips it from every
      project at once. Both rename and remove are single grouped-undo steps,
      via a new `Store.renameTag(from, to)` (mirroring `bulkAddTag`/
      `bulkRemoveTag`'s exact `bulkUpdate()` shape) and the library's existing
      `bulkRemoveTag()` called across every project id. Renaming to a tag
      that already exists on a project **merges** the two instead of leaving
      a duplicate — `renameTag()` dedupes via `Set` — so "fix a typo" and
      "consolidate two near-duplicate tags" are the same one action. A new
      `Store.allTags()` computes the fleet-wide usage counts fresh on every
      render, so the list never drifts from the real live data. No confirm
      dialog on remove, matching the library's existing bulk "Remove tag"
      action's own low-stakes, Undo-toast-only convention. Three new smoke
      checks drive the real UI end to end: the usage count and the "View"
      jump landing on a pre-filtered library, a rename that both updates two
      projects and merges into a third project's pre-existing tag without
      duplicating it (and Undo reverting exactly), and the fleet-wide remove
      (and its Undo). Docs updated.

- [x] **Public site: a "recent activity" ticker under the hero** _(2026-07-04)_:
      the landing page's only nod to the fleet's hourly cadence was a single
      "what's new" line above the CTA buttons — a first-time visitor had no
      sense of *how often* things actually ship. A new horizontally-scrollable
      strip now sits right under the trust-chip row: five small pill chips,
      each `v<N> <title>`, reading live from the exact same `js/changelog.js`
      the in-app "What's new" panel and the existing `#whats-new`/
      `#fleet-manager-status` sync already use — never a hand-typed list that
      could drift, and never fabricated data about any other project (only
      Manager's own real, verified history). It's a genuine scrollable
      element (`overflow-x:auto`, `scroll-snap`), not a text marquee, so it
      stays keyboard- and touch-operable and a screen reader sees five
      ordinary list-like chips rather than one animated blur; a CSS
      `mask-image` fades both edges with zero JS positioning math, mirroring
      the app's existing `.lib-table` scroll-hint philosophy but simpler,
      since a static mask doesn't need a `ResizeObserver`. A light JS drift —
      nudging `scrollLeft` by half a pixel every 30ms, reversing direction at
      each end — gives it the "auto-rotating" feel the roadmap asked for
      without a jarring loop-reset; it pauses instantly on hover, touch, or
      keyboard focus (`mouseenter`/`touchstart`/`focusin` on the track) and
      is skipped entirely under `prefers-reduced-motion` (checked explicitly
      in JS, since a `scrollLeft` nudge is not a CSS animation/transition and
      so isn't caught by the page's existing blanket reduced-motion
      kill-switch). Three new smoke checks drive the real landing page: the
      chips match `CHANGELOG.slice(0,5)` exactly (not the baked-in static
      fallback), the strip actually advances its `scrollLeft` over time and
      stops the moment it's hovered, and — with `prefers-reduced-motion:
      reduce` emulated — it never advances at all.

- [x] **The app-side rail gets the same keyboard-focus ring as everything
      else** _(2026-07-04)_: the last piece of "keyboard-first navigation
      everywhere; focus rings audited" — the prior sweep's landing-page focus
      rings + skip link only touched links/buttons (`a`, `.btn`,
      `.whats-new`); the app's own left rail (`.rail-brand`, `.rail-item`,
      `.rail-toggle` in `js/shell.js`) was always keyboard-reachable via the
      browser's bare default outline, but never carried the app's own
      branded `--ring` treatment every other interactive surface (`.btn`,
      `.status`, `.rel-card`, table rows) already has. All three rail
      elements now get a matching `:focus-visible{outline:none;
      box-shadow:var(--ring)}` rule in `css/styles.css`. The currently-active
      section's own indicator (`.rail-item.active`'s inset left accent bar)
      is layered together with the new ring rather than replaced by it —
      `.rail-item.active:focus-visible` combines both box-shadows into one
      rule — so tabbing to the section you're already on doesn't make its
      accent bar disappear. `.rail-brand` also picked up a `border-radius`
      to match (invisible in its normal transparent-background state, only
      shaping the new focus ring). One new smoke check drives the real app:
      tabs to the logo button, the Dashboard rail item, and the
      collapse/expand toggle in turn, confirming each grows a real
      `box-shadow` on focus that wasn't there before.

- [x] **Public site: an animated live "fleet" showcase** _(2026-07-04)_: the
      landing page's fleet section (`index.html`) was six static cards with
      no motion at all. Each chip's status text (`.fchip .st`) now carries a
      small CSS-only "heartbeat": the bullet dot got pulled out of the
      hand-typed `● Live · v16` string into its own `<span class="dot"
      aria-hidden="true">` + a `<span class="label">` for the visible text,
      so a radiating `::after` ring (`@keyframes fleet-ping`, matching the
      existing `.status .dot` pulse the app itself already uses for a
      "building" status) can glow and fade around just the dot — only on
      `is-live`/`is-active` chips, the two statuses that mean "currently
      shipping" today. Every chip pulses on its own `animation-delay`
      offset (0s/.5s/1s/1.5s/2s/.3s) rather than one synced blink, so the
      showcase reads as several independent projects each quietly shipping
      on their own clock — a deliberately honest "fake" (no fabricated
      per-project timestamps or activity numbers, just an ambient motion cue
      tied to the real, true "each project runs its own loop" claim already
      on the page) rather than a literal but made-up ticker, keeping
      "keep the seed honest" intact. The grid itself also now cascades in
      on scroll — a `transition-delay` ladder (0/.07/.14/.21/.28/.35s) per
      `nth-child` on top of the existing `.reveal` IntersectionObserver
      fade-up — instead of every card popping in at once. Manager's own
      chip (`#fleet-manager-status`) keeps reading its real version from
      `js/changelog.js` exactly as before (Done, 2026-07-04 below); the
      sync script now writes into the new `.label` child specifically so it
      doesn't clobber the dot markup. All of it inherits the page's existing
      global `prefers-reduced-motion` kill-switch (no separate opt-out
      needed). Three new smoke checks drive the real landing page: the
      showcase still renders >=5 chips, the Live/Active dots' `::after`
      pulse animation is present and genuinely offset per chip (not one flat
      synced blink), and the chips' `transition-delay` values differ across
      the grid (a real cascade, not a uniform pop).

- [x] **Sweep: keyboard-focus rings + a skip-to-content link everywhere, and
      honest fleet-showcase status colors** _(2026-07-04)_: the public landing
      page (`css/landing.css`) had never had a single `:focus` rule in it —
      every link and button on the marketing site relied entirely on the
      browser's own default outline, in visual isolation from the actual
      app's carefully-tuned `--ring` focus style (`.btn:focus-visible`,
      `.status:focus-visible`, `.rel-card:focus-visible`, etc. in
      `css/styles.css`). Landing now gets the exact same treatment: a new
      `--ring` var (identical formula to the app's) plus `a:focus-visible`,
      `.btn:focus-visible`, and `.whats-new:focus-visible` rules — placed
      *after* `.btn.primary`'s own box-shadow in source order so the ring
      actually wins the specificity tie on the primary "Launch Manager"
      button rather than being silently overridden by it (caught by an
      end-to-end smoke check that genuinely failed against the first attempt
      before the reorder fixed it). Both the landing page and the app itself
      were also missing a "Skip to content" link — a basic, long-established
      keyboard-navigation pattern, and directly the still-open Next item
      "Keyboard-first navigation everywhere; focus rings audited." A new
      `.skip-link` (invisible until focused, so it never shows for mouse/touch
      visitors) now sits as the very first focusable element on both
      `index.html` (jumping to `<main id="main" tabindex="-1">`) and the app
      shell (jumping to the existing `#view` container, now `tabindex="-1"`
      so focus actually lands there instead of just scrolling) — letting a
      keyboard user skip past the landing nav or the app's ~15-item rail in
      one Tab + Enter. Separately, the fleet showcase's status text
      (`.fchip .st`) colored every project's status the same hardcoded lime
      green regardless of what it said — "Live" and "Active" were visually
      identical, even though the real app's own `STATUSES` table
      (`js/store.js`) gives every status its own distinct color (`s-live`
      teal, `s-active` sky-blue, etc.). The showcase now carries `is-live`/
      `is-active` classes matching each project's real seeded status
      (`js/store.js`'s `P` array — Relay/Games/Polecat/Polecat App/Manager are
      `live`, Solution Eng. is `active`) and colors them with the same teal/
      sky-blue the in-app pills use, so the marketing page's status language
      actually means something at a glance instead of one flat color for
      everything. Four new smoke checks drive the real pages end to end: the
      skip link's hidden-until-focused position on both landing and the app
      (plus confirming the app's version actually moves keyboard focus to
      `#view`, not just scrolls), the primary button's focus ring changing on
      focus, and the fleet chips' Live/Active colors being genuinely
      different values (not just different class names).

- [x] **A "default" saved view** _(2026-07-04)_: saved views (see Done below,
      ×2 earlier this cadence) were user-definable and reorderable, but the
      library still always fell back to whatever `manager.lib.view` last
      held — there was no way to say "open with *this* filter every time." A
      new `isDefault` boolean on the `savedViews` row, toggled via a small
      pin button that now sits in the "Reorder saved views" modal's row
      actions (alongside the up/down arrows — a saved-view chip itself has
      no spare room for a third button beyond apply/delete, so the modal that
      already handles saved-view housekeeping was the natural home). A new
      `Store.setDefaultSavedView(id)` mirrors `reorderSavedViews()`'s shape —
      one grouped `bulkUpdate()` across every saved view so marking a new one
      default atomically clears the flag off whichever view held it before,
      one Undo step for the swap; pass `null` to just turn the current
      default off. `Store.defaultSavedView()` is the single getter every
      consumer reads. The default chip gets a small pin badge ahead of its
      own icon so which view is pinned is visible at a glance without
      opening the modal. Applying it lives in a new `applyDefaultSavedView()`
      (`js/views/projects.js`), called once from `app.js`'s `go()` on a
      *fresh navigation* into Projects — never from the reactive re-render a
      Store change triggers while the user is already there, mirroring the
      exact guard `markReleasesSeen()` already uses for the Releases feed's
      "since you last looked" marker — so a default view can never yank an
      active filter out from under someone mid-visit; it only takes hold the
      next time they actually land on the section. One new smoke check
      drives the real UI end to end: pin a saved view default via the modal,
      confirm the badge and the single-default invariant, dial in a
      different filter and navigate away and back to confirm the default
      wins on the fresh load, then unmark it and confirm a fresh load no
      longer overrides the active filter. Docs updated.
- [x] **Reorderable saved views** _(2026-07-04)_: `savedViews` rows had carried
      the same append-only `order` column `fieldDefs` did before last
      cadence's fix, with the same gap — a saved view always joined the
      library toolbar's chip strip at the end, forever, with no way to bring
      a frequently-used one to the front. A new `Store.reorderSavedViews()`
      mirrors `reorderFieldDefs()` exactly (one grouped `bulkUpdate()` undo
      step, no-op rows skipped). Since a saved view is a compact horizontal
      pill (not a vertical list row), there's no room for its own grip handle
      the way a Settings field row has — so reordering lives in a small
      "Reorder saved views" modal instead, which appears next to the chip
      strip once two or more custom views exist. The modal reuses the exact
      same grip-drag-or-up/down-arrow row shape the custom-field list
      established, now generalized: the native-HTML5-drag-and-drop wiring
      and the arrow buttons' neighbor-swap were factored out of
      `js/views/settings.js` into two small shared helpers in `js/ui.js`
      (`wireDragReorder()`, `swapNeighbor()`), so Settings' custom-field list
      and this new modal share one implementation instead of a hand-copy —
      Settings itself was refactored onto the shared helpers with no change
      in behavior. Closing the modal (or letting a drag/arrow-move commit)
      refreshes the chip strip so the new order shows immediately. Two new
      smoke checks drive the real UI end to end: the up/down arrows swapping
      two saved views (confirming the modal's disabled boundary arrow and
      that the chip strip itself reflects the new order after closing), and
      dragging a view's grip handle above another to reorder it, then
      confirming Undo restores the exact original order.
- [x] **Reorderable custom fields** _(2026-07-04)_: the typed custom-field
      schema (`fieldDefs`) has carried a display-`order` column since it
      shipped, but nothing in the UI let a user actually change it — a new
      field always appended to the end, forever, even one used on every
      project that deserved to surface first. Settings → Custom fields now
      lets you reorder the list two ways: drag a row by its new grip handle
      (native HTML5 drag-and-drop, delegated on the list container so it
      survives re-renders, with the row visibly reordering live as you drag
      over its neighbors), or use a pair of up/down arrow buttons — the
      keyboard- and touch-friendly alternative, since native drag doesn't
      reliably work on real mobile touchscreens. Both paths end at the same
      new `Store.reorderFieldDefs(orderedIds)`, which re-sequences every
      def's `order` in one grouped-undo `bulkUpdate()` call (mirroring every
      other batch edit in the app — one drag or one arrow-click is one Undo
      step, not several), and skip rows whose order doesn't actually change
      so a no-op drag pushes no history. Because every consumer already reads
      the fleet-wide `Store.fieldDefs()` getter (which sorts by `order`)
      rather than hand-rolling its own ordering, the new order takes effect
      everywhere for free: the project detail page's Metadata card, the
      project editor's custom-fields section, and the library toolbar's
      field filter/sort dropdowns all reflect it immediately, with zero
      changes needed at those call sites. Two new smoke checks drive the
      real UI end to end: the up/down arrows swapping two fields (and
      confirming the last row's "move down" arrow is disabled), and dragging
      a field's grip handle above another to reorder it, then confirming
      Undo restores the exact original order.
- [x] **Number-type custom fields as filter range sliders (min/max) in the
      library** _(2026-07-04)_: exact-match/contains filtering already worked
      for Select and Text/URL/Date fields, but a Number field (a score, a
      headcount, a budget) had no way to filter by range — only by typing an
      exact value into the same "contains" box everything else used, which
      barely worked for numbers at all. Picking a Number-type field in the
      library's custom-field filter now shows a **dual-handle range slider**
      instead: two overlapping native `<input type=range>` tracks (the
      standard vanilla dual-slider technique — both transparent and
      full-width, with `pointer-events` scoped to just their thumbs via CSS
      so each stays independently draggable) sitting over a shared base track
      and an accent-gradient fill between the two handles. The slider's
      bounds aren't a fixed 0–100: `buildRangeFilter()` computes the real
      min/max in use across the fleet for that field right now, so a "budget"
      field in the thousands and a "score" field 0–10 both get a travel range
      that actually means something. A live "N – M" readout tracks both
      handles, and a small "×" button resets the filter back to the field's
      full range in one click. State grew two new keys, `fieldMin`/`fieldMax`
      (alongside the existing `field`/`fieldValue`), persisted the same way
      as every other library filter dimension — including into **saved
      views**: `customViewMatches()`, `openSaveViewPrompt()`, and the saved-
      view chip's apply handler all now capture and restore the range too, so
      a pinned view like "budget over $500" reapplies exactly. Select and
      Text/URL/Date fields are untouched — same dropdown, same "contains" box
      as before; only Number changed. Two new smoke checks drive the real UI
      end to end: defining a Number field, giving two real projects distinct
      values, confirming the slider renders with both projects visible
      before narrowing, dragging the min handle past one project's value but
      not the other's and confirming the list narrows to exactly the one
      project, then confirming the reset button restores the full range —
      followed by a cleanup check removing the smoke field and values.
- [x] **Sweep: the public landing page stops lying about Manager's own
      version** _(2026-07-04)_: the app-side version of this exact bug (the
      dashboard tile eternally reading "v1") was fixed earlier this cadence
      by wiring the `manager` project's releases to the real imported
      `CHANGELOG` — but the *public* landing page (`index.html`) never got
      the same treatment, because it's plain static HTML with no Store and
      no build step to inject a value at deploy time. Its hero "what's new"
      banner still read "v1 Mission Control is live" and the fleet showcase's
      Manager card still said "Building · v1", even though the real app was
      on v42 and long since live — both hand-typed once at initial build and
      never revisited since nothing forced a revisit. Fixed the same way the
      app-side bug was fixed: reuse the existing source of truth instead of
      hand-editing a number that will just go stale again. A new
      `<script type="module">` at the bottom of `index.html` imports the
      already-deployed `js/changelog.js` (a pure data export, safe to import
      from a page with no Store) and overwrites both spots with the real
      latest version and title on every page load — `#whats-new` and
      `#fleet-manager-status` are the two elements it targets by id. The
      baked-in static text is now also correct as of this run (a correct
      fallback if JS is ever disabled) but the point is it can't silently
      drift again: next run's changelog entry updates the landing page for
      free, no manual edit required. Along the way, also tightened
      `js/views/docs.js`'s hand-copied paraphrase of the "Active" status
      description, which had drifted slightly from `store.js`'s canonical
      wording (`STATUS_META.active.desc`) into a slightly ungrammatical
      shorthand. Writing this run's own changelog entry surfaced a genuine,
      previously-latent bug in `js/ingest.js`'s safe-parse sync path: its
      "requote every string to JSON" step used two independent blind regexes
      (strip comments, then convert `'…'` spans to `"…"`) with no idea what
      either had already done — so a double-quoted title containing an
      apostrophe (`"Manager's own version"`, exactly this run's own entry)
      made the *later* regex treat that lone apostrophe as the start of a
      new single-quoted span and corrupt every field after it in that
      object. This wasn't a one-off typo to word around — every project's
      changelog is parsed through this exact function on every sync, and any
      real project could publish an entry with the same ordinary quoting
      choice. Replaced it with a single left-to-right pass that tracks
      whether it's inside a string (mirroring the existing
      `extractArrayLiteral`'s approach) so comment-stripping, bare-key
      quoting, and string requoting can never misfire on each other's
      output — verified against all 42 pre-existing changelog entries
      (byte-identical output to the old parser) plus the exact bug case and
      several other quoting edge cases before landing. New smoke checks
      confirm the landing page's banner and fleet-card text always match
      `CHANGELOG[0]`'s real version and title (not a frozen string), and
      that `parseChangelogSource` correctly handles a double-quoted string
      with an apostrophe.

- [x] **"Recently deleted" tray for projects** _(2026-07-04)_: a bulk or
      single project delete has always been one click to Undo — but only the
      *most recent* change, via a toast that disappears, or the Settings →
      Data "Undo last change" button. A project noticed missing a few actions
      later meant undoing everything since, or nothing. Rather than build a
      second, parallel deletion log, this reuses the existing bounded undo
      history (`Store._history`, capped at 40 ops) as its source of truth: a
      new `Store.recentlyDeletedProjects()` scans that stack for delete-shaped
      ops on `projects` — both a single `remove()` and a batched
      `bulkRemove()` — and flattens them into one newest-first list. Each op
      now carries a stable `hid` (generated in `_pushHistory`, backfilled for
      pre-existing persisted history on load) so a specific project can be
      addressed independent of its position in the array, which matters
      because `Store.restoreDeletedProject(hid, id)` needs to pull *one* row
      out of a multi-project bulk-delete op without disturbing the rest of
      that batch's own undo record — restoring one project out of a 3-project
      bulk delete no longer resurrects the other two, and leaves them still
      individually restorable afterward. A new "Recently deleted" button in
      Settings → Data (next to "Undo last change") opens a tray listing every
      recently deleted project with when it was deleted and what else rides
      back with it (its cascaded releases/credentials), each with its own
      one-click Restore — reusing the notes-history modal's row layout
      (`.notes-hist-row`) since the shape is identical, and the same
      "list shrinks, closes itself once empty" behavior the dismissed-
      notifications review modal already established. One new smoke check
      drives the real UI end to end: seeds a single delete and a two-project
      bulk delete, opens the tray, confirms all three are listed with the
      cascaded release called out, restores one project out of the bulk pair
      and confirms its sibling stays gone, restores the singly-deleted
      project and confirms its release comes back with it, then restores the
      last row and confirms the tray closes itself.
- [x] **"Promote to field" on a legacy free-form custom-field value**
      _(2026-07-04)_: a custom-field value entered before the typed schema
      existed showed up in the project editor as a bare, untyped key/value
      pair with no path to formalizing it besides deleting it and recreating
      it under a real field definition by hand. Every legacy row in the
      editor's custom-fields section now gets a "Promote to field" button
      (upload icon, next to its existing delete button); clicking it opens the
      same add-field dialog Settings' schema editor and the "+ New field type"
      shortcut already share (`editFieldDef()`, now taking an `extra` option
      for a prefill/title/save-label/on-added callback rather than a second
      near-duplicate modal), prefilled with a best-effort guess — the key
      humanized into a label ("smoke_docs_link" → "Smoke Docs Link"), and a
      type inferred from the value's shape (a URL, an ISO date, a number, or
      falling back to text). Saving both creates the new fleet-wide field
      definition and carries the project's existing value over onto it in one
      step, deleting the old free-form key. Two new smoke checks cover
      defining/using a plain custom field end to end, and the promote flow
      itself: confirms the dialog opens prefilled with the guessed label and
      type, that saving creates the typed field def and moves the value onto
      its new key, and that the project page renders it as a clickable link
      like any other URL-type field.
- [x] **Bulk "remove tag" in the projects library** _(2026-07-04)_: the bulk
      action bar's `Store.bulkAddTag()` had no opposite — removing a tag that
      was applied too broadly, or retiring one across the fleet, meant
      unchecking it project-by-project in the editor. A new
      `Store.bulkRemoveTag(ids, tag)` mirrors `bulkAddTag()`'s shape exactly:
      same `bulkUpdate()` grouped-undo plumbing, same "skip a row that
      doesn't have the tag" no-op rule so undo never "reverts" a project that
      was never touched. A "Remove tag" button now sits next to "Add tag" in
      the bulk bar; unlike Add tag's bare text input (any spelling is valid —
      it's creating a tag), Remove tag opens a `<select>` built from the
      union of tags already on the *checked* projects only (not the whole
      fleet's tag vocabulary), so there's nothing to mistype and nothing
      offered that couldn't actually apply to this selection. Selecting a
      batch with no tags at all shows an info toast instead of a modal with
      an empty picker. One undo step for the whole batch, exactly like every
      other bulk action. Docs updated. A new smoke check drives the real UI
      end to end: tags two projects (plus an unrelated tag on a third,
      unselected project, to prove the picker only offers what's applicable),
      removes it via the bulk bar, confirms both are untagged and the third
      project's unrelated tag is untouched, then Undoes and confirms the
      whole batch comes back together.
- [x] **Per-project "notes" markdown scratchpad with autosave + history**
      _(2026-07-04)_: every project page had structured fields (status,
      version, health) but nowhere to jot free-form working context ("why
      this is paused", "next thing to try", a link to a design doc) without
      hijacking the curated `description`/`assessment` fields. A new **Notes**
      card on the project detail page is a Markdown scratchpad — one more
      string column on the project row (`notes`), no new Store table needed —
      with an **Edit / Preview** toggle (defaulting to Preview once there's
      content, Edit when blank) rendered through a new small, dependency-free
      `mdToHtml()` in `ui.js` (headings, bold/italic, inline code, fenced code
      blocks, links, lists, block quotes — escaped first, so pasted HTML is
      always shown as text, never executed). It **autosaves on pause**
      (debounced ~800ms, no Save button) via a new `Store.saveProjectNotes()`
      that deliberately bypasses the normal `put()` path for two reasons: it
      shouldn't bump the project's `updatedAt` (typing notes isn't "shipping
      activity" the way a release is, and `updatedAt` feeds recency/health
      scoring), and it shouldn't emit the reactive `projects` event that
      would re-render the whole project page mid-keystroke and steal the
      textarea's focus/cursor — a real bug, verified by actually typing
      through a save cycle before landing on this design. **History** is a
      capped revision trail (`notesHistory`, newest first, 20-deep) kept on
      the project row itself: every autosave stashes the text it's about to
      overwrite, and a History button opens a modal listing each snapshot
      (timestamp + preview) with a one-click **Restore** — which, unlike
      autosave, *is* a deliberate explicit action, so it goes through the
      normal `put()` path (bumps `updatedAt`, re-renders) and itself snapshots
      whatever was live just before the restore, so restoring an old version
      is never a dead end. One new smoke check drives the real UI end to end:
      autosave landing in the Store after a pause, a second edit producing a
      one-entry history with the first draft's exact text, the Preview toggle
      rendering a heading/bold/list from real Markdown, and History → Restore
      putting the original draft back.
- [x] **Sweep: Manager stops lying about its own version** _(2026-07-04)_: the
      "Keep the seed honest" rule already protected the other five fleet
      projects from fabricated version numbers, but Manager's own dashboard
      tile and project page were exempt from the rule they enforce on
      everyone else — the `manager` project's `releases` table only ever held
      the one seeded "v1 — Mission Control launch" row, so the tile eternally
      showed "v1" and "Freshly launched" while the real app had shipped 35
      more versions and hundreds of features. Root cause: every other
      project's releases arrive via a live fetch of its deployed
      `js/changelog.js` (the Sync button, or auto-sync); Manager never
      fetched *itself*. Fixed the honest way — reusing the exact same
      mechanism rather than inventing a parallel one: `js/app.js`'s new
      `syncOwnChangelog()` reconciles the already-imported `CHANGELOG` array
      (`js/changelog.js`) into the `manager` project's releases on every boot,
      via the same `Store.syncReleases()` every project's Sync button calls —
      just with no network round trip, since the data's already loaded
      client-side, so there's no CORS dependency and no per-project click
      required. Manager's dashboard tile, project page, health score, "Latest
      version," and fleet-wide stats now track its real shipped version like
      every other project, and its release rows carry the same "synced" tag
      and "Synced …" timestamp any other project's sync produces. Softened
      the seed's `assessment` copy, which hard-coded "(v1)" and would have
      read as stale the instant the version badge started moving. Chasing
      this down real-content (not seeded placeholders) surfaced a genuine
      320px overflow bug: `.tl-item li` / `.rel-card li` (the bullet text
      under a release headline, in the project timeline and the fleet-wide
      Releases feed) had no `overflow-wrap`, so a single unbreakable token
      long enough to need it (this very CHANGELOG's own description of a past
      env-var-key overflow fix, ironically) forced its whole CSS Grid column
      wider than the viewport — invisible with short seeded text, real with
      an actual shipped changelog. Fixed at the shared rule level (plus
      `.tl-head b`) the same way prior sweeps fixed the credentials-row
      version of this bug. Also hardened a smoke check whose assumption ("no
      project scores >=100, so cranking the health cutoff to 100 must flag
      everyone") broke the instant Manager — which ships every run — could
      legitimately hit a perfect 100; the check now computes its expectation
      from live scores instead of assuming `totalProjects`. New smoke check
      proves Manager's tile/health-panel version and release count match the
      real imported `CHANGELOG` exactly, not a frozen seed.
- [x] **Releases: copy-as-Markdown and a combined JSON/RSS export** _(2026-07-04)_:
      the last item in the Releases feed's shareable-digest queue (the
      "this week" rollup one-liner shipped 2026-07-03). A new **Copy / Export**
      toolbar button opens a small modal with two distinct actions, since they
      have genuinely different scopes: **Copy as Markdown** turns exactly
      what's on screen — the current project/kind/range/search filters, grouped
      the same way as the live toggle (by day or by project) — into a
      `## Releases` list with one heading per group and a bullet per release
      (sub-bullets for its detail items), ready to paste straight into a status
      update or PR description. **Download JSON** / **Download RSS** are
      deliberately *filter-independent*: a combined snapshot of every project's
      releases from the last 30 days, so "what shipped across the suite" can be
      piped into a feed reader or script rather than only ever pasted — matching
      exactly whatever filter happened to be dialed in would make the export
      unpredictable for that use case. The RSS file is a standard RSS 2.0
      document (one `<item>` per release, deep-linking back into the relevant
      project) and the JSON is a small `{generatedAt, windowDays, releases[]}`
      envelope. Under the hood, the on-screen day/project grouping logic was
      factored out into a shared `buildGroups()` so the Markdown export groups
      rows in exactly the same way the live toggle does, rather than a second
      hand-copy that could drift. Two new smoke checks drive the real UI end to
      end: Copy as Markdown (filtered to one project) verified via the
      clipboard, and both downloads verified via Playwright's real download
      events and file contents. Docs updated to describe both actions.
- [x] **Releases: digest/density mode, jump-to-date, and a weekly rollup**
      _(2026-07-03)_: continuing the Releases timeline's highest-value queue
      (grouping + unread marker shipped earlier this cadence), this pass took
      the top three remaining asks. A new **Full / Digest** toolbar toggle
      (mirroring the existing By-day/By-project toggle's single-button,
      icon-swap pattern) collapses every day/project group's cards behind a
      native `<details>`/`<summary>` one-line preview — reusing the exact
      disclosure-marker CSS convention `.merge-review` already established —
      so a long scroll session becomes a scan of headlines instead of every
      release's full detail; nothing is ever removed, only visually deferred,
      and clicking a summary expands that one group back to full cards.
      **Jump to date** is a new select in the same toolbar, populated from
      every distinct day present in the *currently filtered* feed (newest
      first); picking one finds the first release card carrying that day's
      `data-day` attribute — set on every card regardless of grouping mode,
      so the same control works whether the feed is clustered by day or by
      project — opens its parent `<details>` if the target happens to be
      collapsed in Digest mode, scrolls it into view, and gives it a brief
      highlight flash so landing feels obvious rather than a silent jump. The
      **weekly rollup** is a new pasteable one-line banner above the "who
      shipped" chips: "This week across the suite: N releases across M
      projects" — deliberately a *calendar* week (Monday-anchored in CT, via
      a new `ctWeekStartKey()`) rather than the existing "Last 7 days" stat's
      rolling window, so it reads the way an actual status update would say
      it, with a one-click Copy button. Three new smoke checks drive the real
      UI end to end: Digest mode collapsing every group without dropping any
      `.rel-card` from the DOM (and restoring on toggle-back), Jump-to-date
      expanding a collapsed group and flashing the right card, and the weekly
      rollup line rendering with its Copy button. Docs updated to describe
      all three.
- [x] **Releases: "by project" grouping + a fleet-wide "since you last looked"
      unread marker** _(2026-07-03)_: the fleet-wide Releases feed (just
      shipped this cadence) only ever grouped by day. A new toolbar toggle —
      "By day" / "By project", `layers`/`calendar` icon, same single-button
      toggle-in-place pattern the What's-new sheet's sort button already
      uses — switches the same filtered row set into per-project clusters,
      each project's releases still newest-first inside its own group,
      clusters themselves ordered by whichever project shipped most
      recently. Reuses the existing `.feed-day` header component for both
      modes (a day label in one, a project avatar + name in the other) rather
      than a second header style. Separately, the feed now tracks "since you
      last looked" fleet-wide — mirroring `js/views/whatsnew.js`'s
      seen-version idea, but for every project's releases rather than just
      Manager's own changelog: a single `manager.releases.seenTs` timestamp,
      re-armed only when the user actually navigates into Releases (a rail
      click), not on every live re-render that happens to touch the section
      while they're already there (so an auto-sync landing a new release
      mid-visit doesn't silently swallow its own "new" tag). A brand-new
      workspace (or one upgrading into this feature) doesn't get flooded with
      "unread" history — the very first check quietly adopts "now" as the
      baseline instead of treating an unset key as "since the beginning of
      time". Releases newer than the marker get a quiet green `new` tag plus
      a soft left accent on the card (not a loud badge — a feed full of
      unread items shouldn't read as an alarm), and the Releases rail item
      gets its own unread-count badge — the same `setBadge()` plumbing the
      Dashboard's "Needs attention" badge already uses, just without the
      danger tone, so it reads as "new content" rather than "something's
      wrong". Two new smoke checks: the grouping toggle end-to-end (day
      headers carry no avatar, project headers do, toggling back returns to
      day mode), and the unread marker end-to-end (wind the marker back,
      seed a fresh release, confirm the rail badge and the card's `new` tag
      both appear, then confirm opening Releases clears the badge).
- [x] **User-definable saved views in the projects library** _(2026-07-03)_: the
      library's saved-view chips — All / Live only / Recently active / Pinned /
      Needs attention — were a fixed, hardcoded set; a filter someone reached
      for often (say, "Building projects, sorted by version") had to be rebuilt
      by hand from the toolbar every time. A new `savedViews` Store table
      (`Store.savedViews()` / `addSavedView()` / `removeSavedView()`, following
      the exact same `{id, …, updatedAt}` + undo-via-history shape every other
      table already uses) lets a user capture the current status/sort/direction/
      custom-field filter — deliberately *not* the free-text search box, which
      reads as transient, same choice the built-in chips already made — under a
      name of their choosing. The library's saved-views strip now renders these
      right alongside the fixed set, as its own visual style: a `star`-icon pill
      built from two real `<button>`s (apply + a small "×" delete) rather than a
      button nested inside a button, so both halves stay independently keyboard-
      and screen-reader-operable. A chip highlights ("on") exactly when the live
      filter matches every dimension it captured, mirroring how the built-in
      chips already detect their own active state. Deleting a saved view is a
      single click with no confirm dialog — consistent with how bulk tag/status/
      archive actions in the same view already rely on the toast's "Undo" action
      rather than an "are you sure" gate, since nothing about it is hard to
      reverse. Wired into the fleet-wide reactive re-render (`rerenderOn.projects`
      in `app.js`) and the Merge JSON preview/review flow (`savedViews` joins the
      other mergeable tables in `settings.js`'s `MERGE_ROW_LABELS`/`mergeRowHtml`)
      so a saved view behaves like every other piece of Manager data — it syncs,
      merges, and undoes exactly the way a project or credential does. One new
      smoke check drives the real UI end to end: dial in a distinctive filter,
      save it, confirm the chip is highlighted while that filter is active and
      not once you switch away, click the chip's apply half to restore the exact
      filter, then delete it and Undo to bring it back.
- [x] **"Merge & remove": opt in to deleting rows missing from the merge
      file, for genuine two-way sync** _(2026-07-03)_: the last gap in Merge
      JSON was deletes — a merge could add and (as of the item above) update,
      but a row that existed locally and simply wasn't in the incoming file
      was always left untouched, even for someone doing a real two-way sync
      between two browsers that both delete things. `previewMerge()` now also
      buckets local rows whose id is absent from the file into `remove`/
      `removeRows` per table, and `mergeImport()` takes a new
      `{applyRemoves:true}` option that deletes them — off by default, so a
      plain Merge JSON is still exactly as safe/additive as before. A removed
      project cascades its releases/credentials/dismissals through the same
      `_cascadeFor()` helper `Store.remove()` already uses, so nothing gets
      orphaned. The merge dialog gets a second opt-in checkbox, styled in the
      danger color so it visually reads as the riskier of the two boxes
      ("Also remove N rows that exist here but aren't in the file"), and the
      review disclosure lists exactly which rows would go, tagged `remove` in
      danger red alongside the existing `new`/`update` tags — so nothing is
      deleted without the reviewer seeing it named first. The whole merge
      (adds + updates + removes) is still one undo step, so a bad two-way
      sync is one click to reverse.
- [x] **"Merge & update": opt in to refreshing rows that exist in both places
      but differ, with a field-level diff preview** _(2026-07-03)_: Merge JSON
      previously only ever added rows whose id was new — a row that existed
      in both the file and the live workspace but had drifted apart (e.g. a
      release title edited on one machine after a backup was taken on
      another) was silently left alone with no way to opt in. `previewMerge()`
      now buckets every incoming row into `add` (new), `update` (exists here
      but differs), or implicitly skipped (exists here and is byte-identical)
      — a new `Store._rowsDiffer()` decides "differs" via a key-sorted
      stringify rather than raw `JSON.stringify`, so two rows with the same
      content built in a different key order (plausible across browsers/app
      versions) don't falsely show up as changed. The merge dialog gets a new
      "Also update N rows that already exist here but differ" checkbox — off
      by default, so a plain Merge JSON is exactly as additive-only as before
      — and the review disclosure now lists "would update" rows alongside new
      ones, each with a field-by-field diff (`key: old value → new value`)
      right under its name, reusing the same warning-colored "update" tag the
      per-project sync preview already uses for changed releases.
      `Store.mergeImport(text, {applyUpdates})` does the actual overwrite when
      opted in, capturing each updated row's full previous version as the
      undo `prev` (not `null`, unlike a fresh add) so one Undo click restores
      every added row *and* every overwritten row to exactly what was there
      before — mergeImport's return shape changed from a bare count to
      `{added, updated}` so the confirmation toast and the smoke suite can
      tell the two apart. Four new smoke checks: `previewMerge()`'s `update`
      bucket and diff payload in isolation (and that computing it never
      mutates the live row), `mergeImport()` proving the default/opt-in
      behavior and undo restoration at the Store level, and a real
      file-picker → checkbox → diff-review → confirm → Undo pass driving the
      actual UI end to end.
- [x] **Merge-review: expand to see which rows are new, by name, before
      committing** _(2026-07-03)_: the Merge JSON confirm dialog previously
      showed only a per-table add/skip count ("3 new projects, 5 new
      releases") — enough to decide *whether* to merge, but not *what*, for a
      big cross-browser combine where "3 new projects" could hide a name you
      didn't expect. The dialog now has a "Review the N new rows" disclosure;
      expanding it lists every row about to be added, grouped by table, named
      the same way the per-project sync preview already names new/changed
      releases (`v${e.v} ${title}`) rather than a bare count. `Store.previewMerge()`
      now returns each table's actual new row objects (`{add, skip, rows}`)
      alongside the counts, plus the file's raw incoming `projects` map, so a
      new release or credential can be named with its parent project even
      when that project is itself new in the same file and not yet in the
      live store to look up. Building this surfaced a real pre-existing
      mobile bug in the shared `.sync-preview` list (used by both this new
      review list and the original per-project Sync modal): a row's markup
      mixed a `<span>` tag chip with raw text and a `<b>` version number as
      three separate flex children, which the flex layout algorithm was
      squeezing into three narrow independent columns instead of wrapping as
      one paragraph once the title was long enough to need it — invisible
      with short titles, ugly and hard to read with real ones. Fixed at the
      shared CSS level (one wrapper `<span>` per row so there are always
      exactly two flex children, `align-items:flex-start` so the tag anchors
      to the first line instead of the vertical center of a now-multi-line
      block, plus `overflow-wrap:anywhere`/`min-width:0` so an unbroken
      token like a long env-var key wraps instead of forcing the modal
      wider) — verified against both the new merge-review list and the
      original Sync-changelog modal. Five new smoke checks: `previewMerge()`'s
      new `{add, skip, rows}` shape in isolation, the real file-picker →
      review-disclosure → Cancel path confirming the list names an incoming
      release's project correctly even when that project is new in the same
      file, and a dedicated 320px check that seeds a deliberately long
      release title and asserts it wraps as one aligned paragraph rather than
      the pre-fix squeezed-column bug — verified that check actually failed
      against the pre-fix markup before keeping it.
- [x] **Sweep: scroll-direction hints on the projects table + a dead-code pass**
      _(2026-07-03)_: the projects library table (`.lib-table`) scrolls
      horizontally on narrow phones — Status/Latest/Updated/Tags all sit
      off-screen with nothing but a bare scrollbar hinting they exist, easy to
      miss since the mobile scrollbar itself is thin and often auto-hidden.
      It now shows a soft edge-fade overlay on whichever side has more
      content to scroll to (right on load, left once scrolled, both if
      scrolled to the middle), built as two `::before`/`::after` pseudo-
      elements absolutely positioned inside the `position:relative;
      overflow:auto` wrapper — since an absolutely positioned child's
      placement is computed from the container's padding box rather than its
      scrolled content, the fades stay pinned to the visible edges with zero
      JS positioning math, only a `ResizeObserver` + `scroll` listener toggling
      `can-scroll-l`/`can-scroll-r` classes. Verified in both themes (the fade
      gradient is built from `var(--surface-2)`, so it auto-adapts). Also did
      a grep-verified dead-code pass — every CSS selector checked against
      actual usage in the HTML/JS before removal, not guessed: an entire
      leftover "monitor log" panel style block (`.monitor`, `.log-line` and
      its five `.t-*` tag-color variants) from a pre-Activity-view design,
      plus `.chip`, `.topbar .crumb`, `.rail-foot`, and `.token-box` (each
      superseded by a more specific class elsewhere), and four JS functions in
      `js/ui.js` (`$$`, `initials`, `clock`, `shortId`) with zero call sites
      anywhere in the app. New smoke check drives the real table at 320px:
      confirms the right-hint is present on load, scrolling to the end clears
      it and raises the left-hint instead.
- [x] **A "merge" import mode alongside replace-everything import** _(2026-07-03)_:
      the existing Import JSON always wiped the current workspace and replaced
      it wholesale — fine for restoring a backup, but no good for combining a
      backup made in one browser into a *different* browser's workspace
      without losing whatever was already there. Settings → Data now has a
      second button, "Merge JSON", next to Import JSON: it walks every row in
      the chosen file and adds only the ones whose id doesn't already exist in
      this workspace (`projects`, `releases`, `credentials`, `runs`,
      `fieldDefs` — deliberately excluding `dismissals`, which is local
      per-browser "have I seen this" state that doesn't mean anything ported
      from someone else's workspace), leaving every existing row completely
      untouched — never an overwrite, unlike Import JSON's full replace. A new
      `Store.previewMerge()` dry-runs the same per-table id-diff Import JSON's
      `previewImport()` already used the pattern of, so the confirm dialog
      shows exactly what's about to land ("3 new projects, 5 new releases")
      before anything changes; `Store.mergeImport()` does the actual write and
      returns the total rows added. The one genuinely new piece of plumbing:
      a merge can land new rows in *several* tables in one action (a new
      project plus a release for an existing one, say), but the undo stack's
      history entries had only ever tracked a single table per op (even
      bulkUpdate/bulkRemove's grouped entries are one table, many rows). Op
      shape grew a `{tables: {table: items}}` alternative to the existing
      `{table, items}`, and `Store.undo()` was generalized to iterate
      whichever shape is present — so one click on "Undo" removes everything a
      merge added, however many tables it touched, exactly like every other
      grouped undo in the app. Four new smoke checks cover
      `previewMerge()`'s counts in isolation, `mergeImport()` adding rows
      across two tables and undoing both together while proving an existing
      project's data is untouched, and the real file-picker → confirm →
      Cancel / → Merge in paths end to end (Playwright driving an actual
      native file chooser, not just calling the Store methods directly).
- [x] **Bulk delete in the projects library, behind a confirm** _(2026-07-03)_:
      the bulk action bar (select rows via checkbox, act on all of them at
      once) covered tag/set-status/archive — all three easily reversible via
      another status or tag change — but deleting rows outright had no bulk
      path, only the single-project editor's Delete button. A new "Delete"
      button in the bulk bar removes every checked project (and, via the same
      cascade `remove()` already used for a single project, their releases,
      scoped credentials, and dismissals) behind an explicit confirm dialog
      naming up to three of the selected projects by name (`"Relay", "Games",
      and 2 more`) so it's clear what's about to disappear — the one bulk
      action that gets its own "are you sure" rather than firing immediately,
      since a status/tag flip is trivially reversible by eye but a delete
      isn't. Under the hood, `Store.remove()`'s cascade logic was factored
      into a shared `_cascadeFor()` so a new `Store.bulkRemove(table, ids)`
      could reuse it per-row while still recording the *whole batch* as one
      undo step, matching `bulkUpdate()`'s shape; `Store.undo()` was
      generalized to restore each item's own cascade (not just a single
      op-level one), so undoing a bulk delete brings back every deleted
      project's releases along with it, in one click, exactly like undoing a
      single project's delete already did. A new smoke check drives the real
      UI end to end: seeds two temporary projects (one with a release),
      selects both, opens the confirm, Cancels it and verifies nothing was
      touched, reopens it, confirms, verifies both projects and the release
      are gone, then Undoes and verifies the whole batch — project rows and
      the release — comes back together.
- [x] **Import/export the whole workspace as JSON, hardened + round-trip tested**
      _(2026-07-03)_: `Store.exportJSON()`/`importJSON()` and their Settings →
      Data buttons already shipped in v1, but nothing in the suite proved a
      round trip actually worked, and the import button itself had two real
      gaps: clicking it replaced your entire workspace with zero warning (the
      adjacent "Reset workspace" button already had a confirm; import didn't),
      and old undo-history entries survived an import even though their
      snapshots belong to the *previous* dataset — clicking "Undo" right after
      an import could splice stale rows from an unrelated workspace back in.
      Both are fixed: a shared `Store._parseWorkspace()` now backs both a new
      `previewImport(text)` (a dry-run row count per table, thrown as a clear
      error for non-JSON or non-Manager files) and `importJSON()` itself, so
      Settings' import flow reads the file, shows a confirm dialog previewing
      "N projects, M releases, K credentials" before touching anything, and
      only calls `importJSON()` if the user confirms; `importJSON()` now also
      clears the undo-history stack, the same reasoning `reset()` already used
      for the same field. Five new smoke checks cover: `exportJSON()` shape,
      a full round trip (export → mutate → re-import → byte-identical
      `exportJSON()` output, proving the mutation didn't survive), `previewImport`
      being read-only and rejecting garbage JSON, the real file-picker → confirm
      → Cancel path leaving the workspace untouched, and the real
      file-picker → confirm → Import path replacing the data *and* clearing
      `canUndo()` — the last two drive an actual native file chooser via
      Playwright rather than calling `Store.importJSON()` directly, so the UI
      wiring is proven end to end, not just the Store method.
- [x] **Bulk actions in the library (tag, set status, archive) with undo**
      _(2026-07-03)_: every row in the projects library now has a checkbox
      (plus a header "select all" for every currently visible row), and
      checking any of them opens a bulk action bar above the table with a
      live "N selected" count. Three actions: **Add tag** (opens a small
      prompt, appends the tag to every checked project that doesn't already
      have it), **Set status** (a dropdown — any of the six statuses), and
      **Archive** (a one-click shortcut for the common case of setting
      status to Archived across the selection). Each action is recorded as
      a *single* undo step covering the whole batch — clicking "Undo" once
      reverts every row together, not just the last one — via a new
      `Store.bulkUpdate(table, ids, patchFn)` that mutates many rows and
      pushes one grouped history entry (`{table, items:[{id,prev}, …]}`);
      `Store.undo()` was generalized to replay either shape so every
      existing single-row undo caller kept working unchanged. Rows a
      `patchFn` leaves untouched (e.g. a project that already has the tag
      being bulk-added) are skipped entirely — both from the mutation and
      from the undo record — so undo never "reverts" a no-op. Checkbox
      state is intentionally local UI state (module-level in
      `js/views/projects.js`, not a Store table): toggling a checkbox only
      patches the small bulk bar and the header checkbox's
      checked/indeterminate state in place rather than doing a full
      section re-render, so rapid keyboard multi-select (Tab/Space through
      several rows) doesn't lose focus each time — unlike the bulk-action
      buttons themselves, which do trigger a full re-render (matching the
      rest of the app's existing pin-toggle/edit-save convention) since
      they're one-off clicks, not something chained via keyboard. Four new
      smoke checks cover the header select-all, add-tag, set-status
      (including isolation — an unselected project is provably untouched),
      and archive, each verifying the one-step undo restores every row in
      the batch together.
- [x] **Tunable auto-sync backoff cap** _(2026-07-03)_: the multiplier a
      repeatedly-failing project's auto-sync backs off to — doubling the wait
      each consecutive failure — was a fixed constant (`AUTO_SYNC_BACKOFF_CAP`
      in `js/ingest.js`, capped at 8x), even though the fail *threshold* that
      decides when a project counts as "failing" in the first place had
      already been made tunable. `Store.autoSyncBackoffCap()` /
      `setAutoSyncBackoffCap()` join `healthWeights()`/`attentionThresholds()`
      as the tunable-settings pattern, exposed as a new "Failure backoff cap"
      slider (1–64x) in Settings → Auto-sync with a one-click reset;
      `runAutoSync()` now passes the live cap into
      `autoSyncBackoffMultiplier(failCount, cap)` instead of reading a
      hardcoded constant. A project's health panel gets a third override row,
      "Backoff cap", right alongside Weighting and Attention — built from the
      exact same shared `cfg`-object + `overrideRow()`/`openOverrideModal()`
      plumbing factored out last cadence, so this one was a ~20-line
      `AUTO_SYNC_BACKOFF_OVERRIDE` object rather than a third hand-copy of the
      pattern, confirming that refactor's payoff. Same non-destructive shape
      as the other two overrides: disabled (the default) means "use the live
      fleet-wide cap," and the dialed-in number persists even while disabled.
      New smoke checks cover both layers — the fleet-wide slider persisting
      and actually changing `autoSyncBackoffMultiplier`'s output, and the
      per-project override end to end (enable, crank to 32x, confirm a
      *different* project's effective cap is untouched, reset, disable,
      confirm parity with the live fleet default) — plus a fix to the
      pre-existing backoff-multiplier check, which turned out to rely on
      `Array.prototype.map` silently discarding its own `(index, array)`
      arguments; adding the new `cap` parameter meant `map` started feeding
      the array index in as `cap`, a latent footgun the old single-argument
      signature had been masking.
- [x] **Factor the shared per-project override plumbing into one helper**
      _(2026-07-03)_: the health-weighting override and the "needs attention"
      threshold override (both shipped earlier this cadence) had grown into
      two ~90-line, near-identical blocks in `js/views/project.js` — each its
      own row-summary builder, enable/disable toggle + opacity dance, and
      modal chrome, hand-copied from the first to build the second. Both are
      now two small `cfg` objects (`HEALTH_WEIGHTING_OVERRIDE`,
      `ATTENTION_THRESHOLDS_OVERRIDE` — row label, summary formatter,
      Store getters/setters, fleet defaults, and a `fields` array of
      slider definitions) driving one shared `overrideRow()` /
      `openOverrideModal()` pair. `weightingRow`/`attentionRow` are now
      one-line wrappers. Net effect: ~50 fewer lines, and the next
      per-project override (e.g. the auto-sync backoff cap, see Now) is a
      new `cfg` object rather than a third hand-copy of the pattern. Pure
      refactor — no behavior change — verified by running the existing
      per-project-override smoke checks against the new code (they exercise
      both modals end to end: enable, drag every slider, verify isolation
      from another project, reset, disable, confirm parity with the live
      fleet default) and fixing the two slider selectors
      (`.proj-weight-slider`/`.proj-attn-slider`) the checks used, which had
      been keyed on override-specific attribute names (`data-dim`/`data-attn`)
      now unified to one `data-key` attribute across both overrides.
- [x] **Per-project "needs attention" threshold override** _(2026-07-03)_: the
      two cutoffs behind `Store.needsAttention()` — how low a health score has
      to sink, and how many auto-sync failures in a row — were fleet-wide
      only, even after the per-project *health-weighting* override shipped
      earlier this cadence gave a project a way to be *scored* differently.
      That left a gap: a "manual cadence" project that should never be
      flagged just for shipping slowly had no way to opt out of the flag
      itself. A project's health panel now has an "Attention" row right next
      to "Weighting" — "Fleet default" or a "Custom · <N / ×N" summary — with
      the same "Customize" link opening the same two sliders as Settings →
      "Needs attention", scoped to just that project.
      `Store.attentionThresholdsFor(projectId)` is the new single source
      `needsAttention()` reads (per-project, inside its own `.map()`, instead
      of computing the thresholds once for the whole fleet), and every other
      call site that was checking a *specific* project's auto-sync fail count
      against the fleet-wide cutoff (the dashboard tile's "Failing" chip, the
      project health panel's own auto-sync row, and the Settings → Auto-sync
      roll-up) now reads the same per-project-aware helper, so a project
      can't be called "failing" under one cutoff on its own page and a
      different one on the dashboard. Same non-destructive shape as the
      weighting override: the row is stored on the project
      (`attentionThresholdsOverride: {enabled, healthMax, autoSyncFails}`),
      disabling it falls straight back to the live fleet-wide thresholds, and
      the dialed-in numbers persist even while disabled. A new smoke check
      drives the real modal end to end — enables the override, cranks the
      health cutoff to 100 (which must flag the project, since no project
      scores 100), confirms a *different* project's flagged state is
      untouched (isolation), resets, disables, and confirms the effective
      thresholds land back exactly on the live fleet default.
- [x] **Per-project health weighting override** _(2026-07-03)_: the three
      health-score dimensions (recency/velocity/status) were fleet-wide only
      — every project was scored with the exact same weighting, even one
      whose cadence is deliberately different from the fleet norm (e.g. a
      project that's expected to ship rarely, or one where status matters
      far more than recency). A project's health panel now has a
      "Weighting" row — "Fleet default" or a "Custom · R/V/S" summary — with
      a "Customize" link that opens the same three drag sliders as
      Settings → "Fleet health weighting", scoped to just that project.
      `Store.healthWeightsFor(projectId)` is the new single source every
      score calculation reads (`healthScore()` now calls it instead of the
      fleet-wide `healthWeights()` directly), so the override flows
      everywhere a health score shows up — dashboard tile, health panel,
      the fleet health average, "Needs attention" — with zero special-casing
      in any of those call sites. The override is stored on the project row
      itself (`healthWeightsOverride: {enabled, recency, velocity, status}`)
      so turning it off (or resetting the numbers) is non-destructive: the
      dialed-in values persist even while disabled, falling straight back to
      the live fleet-wide weighting rather than losing what was there. A new
      smoke check drives the real modal end to end — enables the override,
      sets an extreme weighting, confirms a *different* project's score is
      untouched (isolation), resets, disables, and confirms the effective
      weights land back exactly on the live fleet default.
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

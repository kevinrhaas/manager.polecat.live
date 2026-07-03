// Changelog powering the in-app "What's new" panel for MANAGER itself.
// (Per-project changelogs live in the Store `releases` table — this is the
// app's own release history.) Newest first.
//
// The hourly self-improvement loop appends a new entry at the TOP for each
// user-visible change (bump `v`, short `title`, optional `kind`, 1–4 `items`).
// Leave `ts` as an EMPTY string on the new entry — the workflow stamps it with
// the real commit time so timestamps are never fabricated. `ts` is ISO-8601
// UTC; the panel formats it to Central Time (shown as CT).
export const CHANGELOG = [
  {
    v: 33,
    title: 'Releases — a fleet-wide “what shipped” timeline',
    kind: 'feature',
    ts: '2026-07-03T21:46:14.058Z',
    items: [
      'A new Releases section in the rail: every project’s releases in one timeline, newest first, grouped by day in CT — the fastest way to see what improved across the whole suite recently.',
      'Up top: summary stats (releases in the last 7 and 30 days, who shipped, the most recent release) and a per-project “who shipped” chip row for the current filter.',
      'Filter by project, kind (feature/polish/fix), and time range (7/30/90 days), or search titles and details. Click any release to jump to that project.',
    ],
  },
  {
    v: 32,
    title: 'User-defined saved views',
    kind: 'feature',
    ts: '2026-07-03T21:38:09.632Z',
    items: [
      'The projects library’s saved-view chips (All/Live/Recent/Pinned/Needs attention) are no longer a fixed set — dial in a status, sort, and field filter, then "Save view" to turn it into your own named chip.',
      'A saved chip highlights whenever its exact filter is active, and one click reapplies it later.',
      'Delete a saved view with its own × button; Undo brings it right back, same as every other change in Manager.',
    ],
  },
  {
    v: 31,
    title: 'Merge & remove, for real two-way sync',
    kind: 'feature',
    ts: '2026-07-03T20:56:59.693Z',
    items: [
      'Merge JSON can now delete rows that exist here but aren’t in the file at all — for two browsers that both add, edit, and delete. Off by default; a plain merge is still purely additive.',
      'The opt-in checkbox and its review-list tag are styled in red so the destructive direction is unmistakable before you commit.',
      'Deleting a project this way cleans up its releases, credentials, and dismissals too, just like deleting it normally does.',
      'Still one Undo for the whole merge — adds, updates, and removes together.',
    ],
  },
  {
    v: 30,
    title: 'Merge & update, not just merge & add',
    kind: 'feature',
    ts: '2026-07-03T20:03:02.604Z',
    items: [
      'Merge JSON can now refresh rows that exist in both places but drifted apart (e.g. a release edited on one machine after the backup was made on another) — opt in with a new checkbox, off by default so a plain merge is still purely additive.',
      'The review disclosure shows a field-by-field diff for every row that would update, old value → new value, before you commit to anything.',
      'Undo reverts an update-applying merge exactly like an add-only one — one click restores every changed row to what it was.',
    ],
  },
  {
    v: 29,
    title: 'Review a merge before committing it',
    kind: 'feature',
    ts: '2026-07-03T19:10:29.621Z',
    items: [
      'Merge JSON now has a "Review the N new rows" disclosure in the confirm dialog — expand it to see exactly which projects, releases, credentials, runs, and custom fields are about to land, by name, before you merge.',
      'Fixed a real mobile bug along the way: a long release title or credential key in these preview lists used to fracture into squeezed, unreadable columns on narrow phones instead of wrapping as one paragraph.',
    ],
  },
  {
    v: 28,
    title: 'Status updates itself from sync',
    kind: 'feature',
    ts: '2026-07-03T18:22:06.097Z',
    items: [
      'A project’s status now tracks its real activity every time it syncs: shipped in the last ~45 days → Live (or Active if it has no live site), gone quiet for 6+ months → Paused. In-between is left alone.',
      'Guardrails: it never overrides Archived, and each project has a Lock toggle (health panel) to pin its status so sync leaves it be. An Idea does promote once it has real releases.',
      'Turn the whole thing off in Settings → Status automation to keep statuses fully manual.',
    ],
  },
  {
    v: 27,
    title: 'Status pills now explain themselves',
    kind: 'polish',
    ts: '2026-07-03T17:54:49.612Z',
    items: [
      'Hover (or focus) any project status — Live, Active, Building, Paused, Idea, Archived — to see exactly what it means, everywhere a status shows.',
      'Clarified that status is an editorial signal you set: syncing pulls a project’s releases, it never changes the status.',
      'Manager’s own seed status is now “Live” (it’s deployed and in use), not “Building”.',
    ],
  },
  {
    v: 26,
    title: 'Scroll hints on the projects table + a dead-code sweep',
    kind: 'polish',
    ts: '2026-07-03T17:15:01.228Z',
    items: [
      'The projects library table scrolls horizontally on narrow phones (Status/Latest/Updated/Tags sit off-screen) with nothing telling you more columns exist — it now shows a soft edge fade on whichever side has more to scroll to, and the fade moves as you scroll, in both themes.',
      'Swept out CSS and JS left behind by earlier redesigns: an old "monitor log" panel style, a handful of unused classes (.chip, .crumb, .rail-foot, .token-box), and four JS helper functions nothing called anymore.',
    ],
  },
  {
    v: 25,
    title: 'Merge JSON — a non-destructive import mode',
    kind: 'feature',
    ts: '2026-07-03T16:36:06.520Z',
    items: [
      'Settings → Data has a new "Merge JSON" button alongside Import JSON: it adds rows from a backup file that don\'t already exist in this browser, and leaves everything already here untouched.',
      'A confirm dialog previews exactly what will be added — "3 new projects, 5 new releases" — before anything changes.',
      'One click on "Undo" removes everything the merge added, even when it landed rows in more than one table at once.',
      'Use this to combine a backup from one browser into another; the existing Import JSON still fully replaces your workspace when that\'s what you want.',
    ],
  },
  {
    v: 24,
    title: 'Bulk delete in the projects library',
    kind: 'feature',
    ts: '2026-07-03T15:37:08.386Z',
    items: [
      'The library\'s bulk action bar (select rows, then act on all of them at once) now has a Delete button alongside Add tag / Set status / Archive.',
      'Deleting removes every checked project — and its releases — behind an explicit "are you sure" confirm, since it\'s the one bulk action that isn\'t just a status/tag flip.',
      'One click on "Undo" restores the whole deleted batch together, same as every other bulk action.',
    ],
  },
  {
    v: 23,
    title: 'Safer workspace import',
    kind: 'feature',
    ts: '2026-07-03T14:56:36.506Z',
    items: [
      'Importing a JSON workspace (Settings → Data) now previews what\'s in the file — project, release, and credential counts — before you commit, and asks you to confirm since it replaces everything currently in this browser.',
      'Importing also clears undo history, so "Undo" can never splice old, unrelated data back into a freshly imported workspace.',
      'Garbage or non-Manager JSON is now rejected with a clear message instead of silently corrupting the workspace.',
    ],
  },
  {
    v: 22,
    title: 'Bulk actions in the projects library',
    kind: 'feature',
    ts: '2026-07-03T13:49:36.735Z',
    items: [
      'Check any number of rows in the projects library — a header checkbox selects (or clears) every currently visible one — and a bulk action bar appears with the live count.',
      'Add a tag, set a status, or archive every checked project in one shot. Each action is a single Undo: one click reverts the whole batch together, not just the last row.',
      '"Archive" is a one-click shortcut for setting status to Archived across the selection, next to the full status dropdown for anything else.',
    ],
  },
  {
    v: 21,
    title: 'Keyboard access to tiles, rows, and quick actions',
    kind: 'polish',
    ts: '2026-07-03T12:43:37.072Z',
    items: [
      'Sweep: the dashboard project tiles, quick-action cards, the "Needs attention" rows (dashboard, bell popover), and every library table row were mouse-only — clickable, but with no way to reach or activate them from a keyboard.',
      'All four are now real tab stops with a visible focus ring, and Enter/Space activates them exactly like a click — without hijacking Enter/Space on a nested button (pin, retry, dismiss, edit) that already has its own action.',
      'Grew the smoke suite with checks that tab to each one and confirm Enter navigates or activates, and that a nested button\'s own Enter doesn\'t also trigger the row underneath it.',
    ],
  },
  {
    v: 20,
    title: 'Tunable auto-sync backoff cap',
    kind: 'feature',
    ts: '2026-07-03T12:05:40.667Z',
    items: [
      'A failing project\'s auto-sync retries less often the longer it stays broken — doubling the wait each failure — but how high that backoff could climb was a fixed 8x. Settings → Auto-sync now has a "Failure backoff cap" slider (1–64x) with a one-click reset.',
      'A project\'s health panel gets a matching "Backoff cap" row next to Weighting and Attention, for a source that should back off harder (or retry sooner) than the fleet norm — same "Customize" pattern, non-destructive toggle.',
    ],
  },
  {
    v: 19,
    title: 'Per-project "needs attention" threshold override',
    kind: 'feature',
    ts: '2026-07-03T09:32:06.641Z',
    items: [
      'The health-score cutoff and auto-sync fail count behind "needs attention" were fleet-wide only — a project on a deliberately different cadence (e.g. one that should never be flagged just for being slow) had no escape hatch.',
      'A project\'s health panel now has an "Attention" row next to its weighting, with the same "Customize" pattern: its own health-score cutoff and auto-sync fail count, scoped to just that project.',
      'Turning the override off (or resetting it) falls straight back to the live fleet-wide thresholds — the dialed-in numbers stick around even while disabled.',
    ],
  },
  {
    v: 18,
    title: 'Per-project health weighting override',
    kind: 'feature',
    ts: '2026-07-03T07:58:29.160Z',
    items: [
      'Every project\'s health score used to blend the same fleet-wide weighting — no way to score a project differently even if its cadence is deliberately unusual.',
      'A project\'s health panel now has a "Customize" link next to its weighting that opens a per-project override: the same recency/velocity/status sliders as Settings → Fleet health weighting, but scoped to just that one project.',
      'Turning the override off (or resetting it) falls straight back to the live fleet-wide weighting — nothing is lost, since the dialed-in numbers stick around even while disabled.',
    ],
  },
  {
    v: 17,
    title: 'Sweep: fixed a real overflow bug + two floating-icon alignment bugs',
    kind: 'polish',
    ts: '2026-07-03T06:52:27.053Z',
    items: [
      'Credentials with a long, unbroken key name (e.g. a real env var like SOME_VERY_LONG_ENV_VARIABLE_NAME) used to push the Reveal/Copy/Edit buttons completely off-screen on a narrow phone — fixed by letting monospace text break instead of forcing the whole row wider than the viewport.',
      'On a narrow phone, the toggle switch on a Settings row (e.g. "Simple mode") and the run-mode icon in the Activity log used to float vertically centered against the middle of a wrapped, multi-line description or note instead of sitting beside its first line — both now stay pinned to the top.',
      'Grew the smoke suite with three checks that reproduce all three bugs against real content, verified to fail on the old code and pass on the fix.',
    ],
  },
  {
    v: 16,
    title: 'Tunable "Needs attention" thresholds',
    kind: 'feature',
    ts: '2026-07-03T05:12:26.963Z',
    items: [
      'Settings → "Needs attention" now lets you tune how sensitive the bell, rail badge, and dashboard callout are — a health-score cutoff and an auto-sync fail count, both drag sliders with a live "N of M projects flagged" readout.',
      'Previously these were fixed: a project only ever flagged once its health slipped to Slowing/Stale, and only after 2 auto-sync failures in a row.',
      'The per-project "Failing ×N" badge (project tile, health panel, and the Settings → Auto-sync roll-up) now uses the same tunable threshold, so a project is called "failing" consistently everywhere.',
      'One-click reset restores the shipped defaults (35 and 2) — the exact behavior this replaces.',
    ],
  },
  {
    v: 15,
    title: 'Dismiss a "Needs attention" notification',
    kind: 'feature',
    ts: '2026-07-03T03:39:22.059Z',
    items: [
      'Every row in the "Needs attention" list — on the dashboard callout and in the notification bell — now has a Dismiss action, so a problem you\'ve already seen can stop pinging you without needing to be fixed first.',
      'Dismissal is scoped to the exact reason it was raised for: if a dismissed project gets *worse* or a new problem shows up (say, its auto-sync also starts failing), it comes right back — a dismissal never hides a genuinely new issue.',
      'Nothing is thrown away — a "N dismissed" link on the dashboard callout and the bell popover opens a review list to restore any of them, and dismissing shows an instant "Undo" toast.',
      'The rail\'s Dashboard badge and the bell badge now count only active (undismissed) items; the library\'s "Needs attention" saved view is unchanged and still shows everything, dismissed or not.',
    ],
  },
  {
    v: 14,
    title: 'Rail badges Dashboard with the "Needs attention" count',
    kind: 'feature',
    ts: '2026-07-03T02:08:38.911Z',
    items: [
      'The rail\'s Dashboard item now shows the same live "Needs attention" count as the notification bell and dashboard callout, so a slipping project is visible in the nav itself — even before you land on the dashboard.',
      'With the rail collapsed to icons (the default), the count shrinks to a small dot on the Dashboard icon; opening the rail reveals the full number.',
    ],
  },
  {
    v: 13,
    title: 'Notification center',
    kind: 'feature',
    ts: '2026-07-03T01:25:25.592Z',
    items: [
      'A bell in the topbar now surfaces the same "Needs attention" signal as the dashboard callout — a live badge count and a click-through popover — from anywhere in the app, not just the dashboard.',
      'The popover lists every project whose health has slipped or whose auto-sync is failing, with a one-click "Retry now" and a jump to the project, plus an "Open dashboard" shortcut to the fuller view.',
      'Shows a calm "All clear" state when nothing needs attention, and the popover is positioned to always stay on-screen no matter how narrow the phone.',
    ],
  },
  {
    v: 12,
    title: 'Mobile sweep: three squeezed-text rows fixed at phone widths',
    kind: 'polish',
    ts: '2026-07-03T00:47:04.000Z',
    items: [
      'The "Sync all changelogs" modal used to squeeze project names down to unreadable fragments ("M..", "R..") on a narrow phone when a status chip like "10 New, 1 Updated" claimed most of the row — the status now drops to its own line under the name instead.',
      'The admin "Invites you’ve created" list and the Settings → Custom fields row both centered their action buttons against the *whole* row, so a long label wrapping to several lines made the buttons appear to float in the middle of the text — both now keep actions anchored to the top (or wrapped cleanly below) instead.',
      'The mobile no-overflow smoke check is now a loop over every rail section at 320px instead of two one-off spots, plus three new checks that pin down these exact regressions.',
    ],
  },
  {
    v: 11,
    title: '"Needs attention" rollup',
    kind: 'feature',
    ts: '2026-07-02T23:51:07.889Z',
    items: [
      'A new dashboard callout lists every project whose health has slipped to Slowing/Stale or whose auto-sync is failing — reasons, one-click "Retry now", and a jump to the project, right at the top of the fleet view.',
      'A matching "Needs attention" saved view in the projects library filters the table to the same set, so it works whichever surface you live in.',
      'Nothing renders when the fleet is healthy — this only shows up when something actually needs a look.',
    ],
  },
  {
    v: 10,
    title: 'Tunable fleet health weighting',
    kind: 'feature',
    ts: '2026-07-02T23:17:51.769Z',
    items: [
      'Settings → "Fleet health weighting" turns the three signals behind every health score — recency, release velocity, and status — into drag sliders instead of fixed constants.',
      'They\'re relative: whatever you set them to, they\'re renormalized to always add up to 100, so "50/30/20" and "5/3/2" score identically.',
      'Every score recalculates live from your weights everywhere it shows — dashboard tiles, the fleet health average, and each project\'s health panel — with one click to reset back to the shipped default (40/40/20).',
    ],
  },
  {
    v: 9,
    title: 'Auto-sync retry/backoff signal',
    kind: 'feature',
    ts: '2026-07-02T22:47:01.229Z',
    items: [
      'A project whose auto-sync keeps failing (dead site, CORS, 404) now backs off — each consecutive failure doubles the wait before retrying, capped at 8x the usual interval — instead of hammering an unreachable source forever.',
      'After 2 failures in a row it shows a "Failing ×N" badge with the reason, right in that project\'s health panel and on its dashboard tile, plus a one-click "Retry now".',
      'Settings → Auto-sync now rolls up which opted-in projects are currently failing, so nothing fails silently in the background.',
    ],
  },
  {
    v: 8,
    title: 'Fleet health score + release-velocity sparklines',
    kind: 'feature',
    ts: '2026-07-02T22:25:00.958Z',
    items: [
      'Every project now gets a 0–100 health score (Thriving / Healthy / Steady / Slowing / Stale) blending release recency, release velocity, and project status — shown as a badge on dashboard tiles and in the project detail health panel.',
      'A tiny 10-week bar sparkline next to the score shows release velocity at a glance, everywhere the score appears.',
      'A new "Fleet health" stat card on the dashboard averages every project\'s score into one at-a-glance read on the whole fleet.',
    ],
  },
  {
    v: 7,
    title: 'Mobile polish sweep',
    kind: 'polish',
    ts: '2026-07-02T22:07:02.719Z',
    items: [
      'Fixed a horizontal-scroll bug on the public landing page on small phones (390px and narrower) — the top nav and the "Enter with your token" button no longer clip off-screen.',
      'Fixed the same class of overflow on every app section (project detail, dashboard, library, credentials, docs, settings) — a header\'s action buttons now wrap onto their own row instead of running off the edge on narrow screens.',
      'Grew the smoke suite with two new checks that fail if either page regresses to a horizontal scrollbar on a narrow phone.',
    ],
  },
  {
    v: 6,
    title: 'Faster, safer auto-sync',
    kind: 'feature',
    ts: '2026-07-02T21:12:20.234Z',
    items: [
      'Auto-sync now runs on a real background loop — so a project actually re-checks on its interval while the app is open, not only when you reload.',
      'The interval can go all the way down to every 1 minute (1m / 5m / 15m / 30m / 1h / 3h / 6h / 12h / 24h).',
      'Made safe for those short intervals: a check that’s still in flight never starts another, polling pauses while the tab is hidden, and you only get a toast when something actually changed.',
    ],
  },
  {
    v: 5,
    title: 'Auto-sync & force sync',
    kind: 'feature',
    ts: '2026-07-02T20:52:45.733Z',
    items: [
      'Auto-sync quietly re-pulls an opted-in project\'s changelog on app open and on a cadence you choose — no modal, just new releases banked and a "last auto-synced" time. Turn it on fleet-wide in Settings, then opt individual projects in from their health panel.',
      'Force sync fully reconciles a project\'s releases to its source — it overwrites rows that drifted (even ones you hand-edited) and removes synced releases no longer published upstream, behind a confirm since it\'s deliberate.',
      'Both sit right next to the existing Sync button on the project page, and "Force sync all" now sits next to "Sync all" on the dashboard.',
    ],
  },
  {
    v: 4,
    title: 'Typed custom fields',
    kind: 'feature',
    ts: '2026-07-02T20:01:44.339Z',
    items: [
      'Custom project metadata is now a real, fleet-wide schema — define fields with a type (Text, Number, URL, Date, or a fixed Select list) once in Settings → Custom fields, and every project shares them.',
      'The project editor shows the right control for each field (a date picker, a dropdown of your options, etc.) instead of a bare text box, and you can define a brand-new field type without leaving the editor.',
      'Typed values render properly on the project page — URLs are clickable links, dates are formatted, and Select values show as a tag.',
      'The projects library can now filter by any custom field\'s value, and Number/Date fields join the sort dropdown alongside name, status, and version.',
    ],
  },
  {
    v: 3,
    title: 'Fleet-wide sync',
    kind: 'feature',
    ts: '2026-07-02T18:57:47.666Z',
    items: [
      'A "Sync all" quick action on the dashboard pulls every project\'s real changelog in one pass — no more clicking Sync on each project one at a time.',
      'Shows a live per-project checklist as it runs: fetching, new/updated release counts, or a clear failure reason, plus a fleet-wide summary when it\'s done.',
      'Projects with no site or changelog URL are skipped and called out, not silently ignored.',
      'The run is logged to Activity so the fleet\'s cadence log shows when a bulk sync happened.',
    ],
  },
  {
    v: 2,
    title: 'Live changelog sync',
    kind: 'feature',
    ts: '2026-07-02T17:09:57.686Z',
    items: [
      'A project’s "What’s new" timeline can now pull its real releases straight from its deployed site — a "Sync" button on the project page fetches its changelog.js, previews what’s new or changed, and imports on your say-so.',
      'Fetching never executes remote code — the changelog data is parsed as plain data, so a blocked or broken source can only fail to load, safely.',
      'Cross-origin fetches are often blocked by CORS; when that happens Manager shows a clear explanation and lets you paste the file’s contents in instead.',
      'Set a custom changelog URL per project (or let Manager guess it from the live site), and see the last-synced time on the project’s health panel.',
    ],
  },
  {
    v: 1,
    title: 'Mission Control launch',
    kind: 'feature',
    ts: '2026-07-02T00:00:00Z',
    items: [
      'A live dashboard of project tiles — status, last-updated in CT, latest version, a short assessment, and one-click links to each project’s site, its what’s-new, and the Claude Code session you drive it from.',
      'A projects library with filtering, sorting, search, pinning, and full metadata editing (add your own fields).',
      'Project detail pages with the complete what’s-new timeline, a credentials vault, in-app docs, a welcome tour, Simple mode, history + undo, and an invite-only admin gate.',
      'Dark & light themes, mobile-first layout, and a Playwright battery that gates every release.',
    ],
  },
];

export const LATEST_VERSION = CHANGELOG.reduce((m,e)=>Math.max(m,e.v),0);

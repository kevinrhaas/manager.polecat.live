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
    v: 12,
    title: 'Mobile sweep: three squeezed-text rows fixed at phone widths',
    kind: 'polish',
    ts: '2026-07-03T12:00:00.000Z',
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

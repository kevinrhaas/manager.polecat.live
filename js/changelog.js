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

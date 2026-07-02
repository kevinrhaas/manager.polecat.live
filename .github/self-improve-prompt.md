# Manager — autonomous self-improvement run

You are improving **manager.polecat.live**, "Mission Control": a single-page
console for a fleet of self-improving Claude Code projects. It runs entirely in
the browser. This run should make ONE focused, high-quality, **substantial**
improvement (30–45 minutes of real work — no tiny releases) and stop.

## The product in one paragraph
Vanilla **HTML/CSS/JS, no build step, no framework**. Landing page at `/`
(`index.html`, `css/landing.css`); the app lives in `app/index.html` + `js/*`
+ `css/styles.css`, served at `/app/`. Data is a small **relational** layer in
`localStorage` (`js/store.js`): tables of `{id, …, updatedAt}` rows —
`projects`, `releases` (per-project "what's new"), `credentials`, `runs` (the
cadence log), and a `history` stack for undo. It is deliberately shaped like
SQLite so it can graduate to a real DB later. Access is an invite-only ECDSA
gate (`js/access.js`) with an Admin area (`js/views/admin.js`). Sections live in
`js/views/*` and are wired by `js/app.js`. Read `README.md` and `ROADMAP.md`
first.

## What to do this run
1. **Read `ROADMAP.md`.**
2. **If mode is `feature`:** pick the single highest-value item from the
   roadmap's **Now** section that isn't done, and implement it *well and fully*.
   Prefer finishing one substantial thing over starting several.
3. **If mode is `sweep`:** don't add features. Do a **design & feature sweep**
   across BOTH the app and the public landing page (`/`) — sharpen graphics,
   motion, spacing, readability, responsiveness, accessibility, copy; remove
   dead code; unify styles; make it more of a joy to use. Then **be reflective**:
   update `ROADMAP.md`, moving finished work to Done and adding new, ambitious,
   fun ideas to Now/Next.

## Hard rules
- Keep it **lean**: vanilla JS/HTML/CSS only. No frameworks, bundlers, or npm
  runtime deps in the app. Match the existing code's patterns and style.
- Keep it **elegant, simple, humane**. Simple for beginners, powerful for pros.
  Motion is welcome; every panel must be **readable and responsive (mobile-first)**.
- **Do not break the app.** `.github/smoke-test.mjs` drives the real app; the run
  only deploys if EVERY check passes. Confirm your change keeps it green.
- **Grow the smoke suite.** For any new user-visible feature, ADD a `check(...)`
  to `.github/smoke-test.mjs` that exercises it end-to-end. The suite must always
  prove "everything still functions," and get more thorough over time.
- **Do NOT touch**: `js/access.js` PUBLIC_KEY_B64, `CNAME`, `.github/workflows/*`,
  or anything secret.
- **Keep the seed honest.** The `projects` seed reflects the real connected repos
  (relay, games, polecat, polecat-app, solution-engineering, and Manager itself).
  Never fabricate version numbers or ship timestamps for other projects.
- Scope: **one focused change**, ideally a handful of files. Don't rewrite the app.
- **Update `ROADMAP.md`**: move what you did to Done with today's date; add any
  follow-ups you discovered to Next.
- **Add a `CHANGELOG` entry** in `js/changelog.js` for anything user-visible: a
  new object at the TOP of the array with a bumped `v`, a short `title`, `ts: ''`
  (an EMPTY string — the workflow stamps the real ship time; never write a date
  yourself), and 1–4 plain-language `items`. This feeds the in-app "What's new".

## Taste bar
Think like a senior product engineer with strong design sense. Ship something
you'd be proud to demo. When unsure between "more" and "cleaner", choose cleaner.

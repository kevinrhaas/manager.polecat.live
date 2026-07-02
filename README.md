# manager.polecat.live

**Mission control for a fleet of self-improving Claude Code projects.**

Manager is a single-page console that sits *on top of* the projects you drive
with Claude Code — each one running its own self-improvement loop (a cron
routine or a GitHub Action). From one dashboard you can watch every project's
status, latest version, and "what's new", jump straight to the Claude Code
session steering the work, and curate a library of projects with rich metadata.

Pure **static HTML/CSS/JS** — no build step, no framework, no backend. Data
lives in your browser's `localStorage`, modeled as tidy relational tables so it
can graduate to SQLite later with zero reshaping. Deployed to GitHub Pages at
[manager.polecat.live](https://manager.polecat.live).

Part of the [polecat.live](https://polecat.live) family — shares Relay's aurora
dark theme and collapsible "rail" navigation, re-skinned into a cyan/indigo
**Mission Control** identity.

---

## What it does

- **Dashboard** — a live wall of project tiles. Each shows status, last-updated
  time in **CT**, latest version, a short assessment, and one-click links to the
  project's live site, its "what's new", and the **Claude Code session** you
  drive it from.
- **Projects library** — filter, sort, search, pin, and edit every project.
  Add your own metadata fields. This is the source of truth for the fleet.
- **Project detail** — the full "what's new" timeline (latest + every prior
  release), plus links and an at-a-glance health panel.
- **Activity** — the cadence log of self-improvement runs. Manager tracks the
  feature/polish/sweep rhythm (every 5th feature run → a design & feature sweep).
- **Credentials & config** — set shared secrets once (global) or per-project.
- **Docs** — complete in-app documentation for first-time users.
- **What's new** (this app) — a searchable, filterable, sortable changelog with
  customizable tracked attributes.
- **Admin** — invite-only, token-gated access (ECDSA-signed links, no server).

## Delight & accessibility

Dark mode by default with a light theme, a restartable **welcome tour**, a
**Simple mode** that hides advanced surfaces for newcomers, **history + undo**,
game-like motion, and a mobile-first responsive layout. Every release is gated
by a Playwright battery that drives the real app end-to-end.

## Running it

No build step. Serve the folder statically:

```bash
python3 -m http.server 8137   # landing → http://localhost:8137
                              # app     → http://localhost:8137/app/
```

## Layout

```
index.html            # marketing landing page (front door at /)
css/landing.css       # landing styles
app/index.html        # the app shell (served at /app/)
css/styles.css        # full app design system (Mission Control palette)
assets/logo.svg       # Manager mark
js/
  app.js              # controller: boot, routing, topbar, cross-view glue
  store.js            # relational data layer (projects, releases, creds, runs, history)
  access.js           # invite-only ECDSA gate + admin token
  shell.js            # collapsible / draggable rail navigation
  theme.js            # dark / light / system
  ui.js               # DOM helpers, toasts, modals, formatting
  icons.js            # inline SVG icon set
  changelog.js        # this app's "what's new" data
  tour.js             # welcome tour
  views/              # home, projects, project, activity, credentials, docs, admin, settings, whatsnew
.github/
  workflows/deploy.yml        # publish repo root to Pages on push to main
  workflows/self-improve.yml  # hourly Claude Code self-improvement → main → deploy
  self-improve-prompt.md      # the autonomous run playbook
  smoke-test.mjs              # Playwright functional battery (the release gate)
```

## Access

The app is an invite-only preview. Open it with an admin token (full access,
can mint invites) or a user invite link. Admins mint shareable links from the
in-app **Admin** area; every link is an unforgeable ECDSA signature checked
entirely client-side.

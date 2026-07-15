// -----------------------------------------------------------------------
// catalog.js — the fleet registry: every app in the Polecat suite, in one
// vendored module. The launcher grid on polecat.live and the waffle
// app-switcher in every app's topbar both render from this list, so adding
// an app to the suite is one entry here + the next shell release.
//
// Vendored data (not fetched JSON) on purpose: offline-safe, versioned with
// the shell, and no cross-origin dependency just to draw a menu. LIVE
// status (latest version, last-ship time) is layered on top at runtime by
// ingesting each app's /js/changelog.js — see site/js/ingest.js — and
// degrades gracefully to this static list when offline.
//
// `icon` is a name resolved through icons.js (single-color, currentColor);
// `accent` is a hint the launcher/waffle may use for the tile glyph only —
// chrome always follows the viewer's theme, not the app's brand.
// -----------------------------------------------------------------------

export const FLEET = [
  { id: 'chat',         name: 'Chat',         url: 'https://app.polecat.live',
    tagline: 'Ask once. Hear from everyone — multi-model consensus.',
    icon: 'chat',       accent: '#8b5cf6', status: 'live', visibility: 'public',
    changelogUrl: 'https://app.polecat.live/js/changelog.js' },

  { id: 'jobtracker',   name: 'JobTracker',   url: 'https://jobtracker.polecat.live',
    tagline: 'Creative-work tracking with saved views, boards, and joy.',
    icon: 'briefcase',  accent: '#7c5cff', status: 'live', visibility: 'public',
    changelogUrl: 'https://jobtracker.polecat.live/js/changelog.js' },

  { id: 'analytics',    name: 'Analytics',    url: 'https://analytics.polecat.live',
    tagline: 'Dashboard Studio — connect a database, build, export.',
    icon: 'chart',      accent: '#b8632e', status: 'live', visibility: 'public',
    changelogUrl: 'https://analytics.polecat.live/js/changelog.js' },

  { id: 'autoselector', name: 'AutoSelector', url: 'https://autoselector.polecat.live',
    tagline: 'The joyful way to find your car.',
    icon: 'car',        accent: '#2f81f7', status: 'live', visibility: 'public',
    changelogUrl: 'https://autoselector.polecat.live/js/changelog.js' },

  { id: 'relay',        name: 'Relay',        url: 'https://relay.polecat.live',
    tagline: 'Serverless peer-to-peer tables and chat.',
    icon: 'network',    accent: '#21c7a8', status: 'live', visibility: 'public',
    changelogUrl: 'https://relay.polecat.live/js/changelog.js' },

  { id: 'games',        name: 'Games',        url: 'https://games.polecat.live',
    tagline: 'An ever-growing neon arcade of story-driven retro games.',
    icon: 'gamepad',    accent: '#ff2e97', status: 'live', visibility: 'public',
    changelogUrl: 'https://games.polecat.live/js/changelog.js' },

  { id: 'manager',      name: 'Manager',      url: 'https://manager.polecat.live',
    tagline: 'Mission control for the fleet.',
    icon: 'gauge',      accent: '#38bdf8', status: 'live', visibility: 'public',
    changelogUrl: 'https://manager.polecat.live/js/changelog.js' },
];

export function fleetApp(id){ return FLEET.find(a => a.id === id) || null; }

// Public entries only — what logged-out surfaces (launcher, waffle) show.
export function publicFleet(){ return FLEET.filter(a => a.visibility === 'public'); }

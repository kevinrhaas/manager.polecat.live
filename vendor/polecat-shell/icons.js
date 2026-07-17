// -----------------------------------------------------------------------
// icons.js — Polecat Shell inline SVG icon set.
//
// Single-color, stroke-based icons that inherit currentColor so they theme
// for free (fleet design bar: never ship multi-color or filled sets).
// 24×24 viewBox, stroke-width 1.7, round caps/joins.
//
// `icon(name, size)` returns an SVG string. The base set is the generic UI
// family ported from JobTracker (nav, controls, status), extended with the
// generically useful extras from Manager (gauge, trophy, lock, globe, …),
// the media/chrome controls promoted from Games (back, fullscreen, sound,
// muted — v0.4.0), plus a `waffle` 3×3 grid authored for the app switcher.
// App-specific
// families (e.g. JobTracker's marketing-deliverable icons) stay in the app
// and register themselves via registerIcons().
// -----------------------------------------------------------------------

const P = {
  // ---- navigation / ui (JobTracker base set) ----
  home:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  board:'<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="14" rx="1.5"/>',
  calendar:'<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/>',
  timeline:'<rect x="3" y="5" width="9" height="3.4" rx="1.2"/><rect x="7" y="10.3" width="14" height="3.4" rx="1.2"/><rect x="3" y="15.6" width="11" height="3.4" rx="1.2"/>',
  settings:'<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  key:'<circle cx="8" cy="8" r="4"/><path d="m11 11 8 8M16 16l2-2M13 13l2-2"/>',
  shield:'<path d="M12 3 5 6v5c0 4.2 2.9 7.9 7 9 4.1-1.1 7-4.8 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  book:'<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 5.5v15"/>',
  chart:'<path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8"/>',
  activity:'<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  users:'<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17 20a5.5 5.5 0 0 0-3-4.9"/>',
  inbox:'<path d="M3 13h5l1.5 3h5L21 13"/><path d="M3 13 5.5 5h13L21 13v6H3z"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',
  chevron:'<path d="m9 6 6 6-6 6"/>',
  chevronDown:'<path d="m6 9 6 6 6-6"/>',
  sun:'<circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v2.5M12 20v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M1.5 12H4M20 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8"/>',
  moon:'<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5"/>',
  sparkle:'<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  bolt:'<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  star:'<path d="m12 3 2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L12 17.8 6.4 20.4l1.4-6.3L3 9.8l6.4-.6z"/>',
  check:'<path d="m5 12 5 5L20 7"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  fire:'<path d="M12 3c1 3-1.5 4-1.5 6.5A2.5 2.5 0 0 0 13 12c1-1 .5-3 .5-3 2 1.5 3.5 3.6 3.5 6a5 5 0 1 1-10 0c0-3 2.5-4.5 3-7.5.3-1.7.7-3 2-4.5z"/>',
  flag:'<path d="M5 21V4M5 4h11l-1.5 4L16 12H5"/>',
  edit:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash:'<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  link:'<path d="M9 15l6-6"/><path d="M10.5 6.5 12 5a4 4 0 0 1 6 6l-1.5 1.5M13.5 17.5 12 19a4 4 0 0 1-6-6l1.5-1.5"/>',
  upload:'<path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"/>',
  download:'<path d="M12 4v12m0 0 4-4m-4 4-4-4"/><path d="M4 18v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1"/>',
  filter:'<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
  sort:'<path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3"/>',
  close:'<path d="M6 6l12 12M18 6 6 18"/>',
  clone:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  undo:'<path d="M9 7 4 12l5 5"/><path d="M4 12h11a5 5 0 0 1 0 10h-3"/>',
  redo:'<path d="m15 7 5 5-5 5"/><path d="M20 12H9a5 5 0 0 0 0 10h3"/>',
  history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 4v4h4M12 8v4l3 2"/>',
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  comment:'<path d="M4 5h16v11H9l-5 4z"/>',
  db:'<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  layers:'<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  rocket:'<path d="M5 15c-2 1-2 5-2 5s4 0 5-2m3-1c5-1 8-5 9-13-8 1-12 4-13 9z"/><circle cx="14.5" cy="9.5" r="1.6"/><path d="M9 12l-2 3 2 2 3-2"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  tag:'<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  folder:'<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  wand:'<path d="m5 19 9-9m2-2 2-2M15 5l1-1M20 9l1-1M19 13l1 1M14 5l-1-1"/><path d="m14 8 2 2"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  warn:'<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  play:'<path d="M7 4v16l13-8z"/>',
  compass:'<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  bell:'<path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6z"/><path d="M9.5 19a2.5 2.5 0 0 0 5 0"/>',
  more:'<circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/>',
  // ---- generically useful extras (from Manager's set) ----
  gauge:'<path d="M12 13l4-4M20 16a8 8 0 1 0-16 0M12 13a1.5 1.5 0 1 0 0 .01"/>',
  chevronUp:'<path d="M6 15l6-6 6 6"/>',
  grip:'<path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01"/>',
  pin:'<path d="M12 2l2.4 5 5.6.5-4.2 3.8 1.3 5.7L12 19l-5.1 3 1.3-5.7L4 12.5 9.6 12 12 2Z"/>',
  trophy:'<path d="M7 4h10v4a5 5 0 0 1-10 0V4ZM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M9 15v2h6v-2M8 21h8M10 17h4"/>',
  external:'<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  refresh:'<path d="M4 12a8 8 0 0 1 14-5.3L21 9M20 12a8 8 0 0 1-14 5.3L3 15M21 4v5h-5M3 20v-5h5"/>',
  lock:'<path d="M6 11h12v9a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-9ZM8 11V7a4 4 0 0 1 8 0v4"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  sliders:'<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  terminal:'<path d="M4 5h16v14H4zM7 9l3 3-3 3M13 15h4"/>',
  branch:'<path d="M6 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM6 7v6a4 4 0 0 0 4 4h4M18 13a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM18 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM18 7v0"/>',
  chat:'<path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.3-4.2A8 8 0 1 1 21 12ZM8 11h.01M12 11h.01M16 11h.01"/>',
  archive:'<path d="M3 4h18v5H3zM5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
  notes:'<path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM14 2v6h6M8 13h8M8 17h5"/>',
  eyeOff:'<path d="M17.9 17.9A9.96 9.96 0 0 1 12 20c-7 0-11-8-11-8a18.4 18.4 0 0 1 5-5.9M9.9 4.24A9.5 9.5 0 0 1 12 4c7 0 11 8 11 8a18.4 18.4 0 0 1-2.16 3.19M14.1 14.1a3 3 0 1 1-4.2-4.2M1 1l22 22"/>',
  // ---- chrome / media controls (promoted from Games' game-chrome) ----
  back:'<path d="m15 6-6 6 6 6"/>',
  fullscreen:'<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
  sound:'<path d="M4 9v6h3l5 4V5L7 9H4z"/><path d="M16 8.5a4 4 0 0 1 0 7M18.7 6a7 7 0 0 1 0 12"/>',
  muted:'<path d="M4 9v6h3l5 4V5L7 9H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  // ---- authored for the shell ----
  // 3×3 launcher grid for the fleet app switcher (single path, house stroke).
  waffle:'<path d="M4 4h3v3H4zM10.5 4h3v3h-3zM17 4h3v3h-3zM4 10.5h3v3H4zM10.5 10.5h3v3h-3zM17 10.5h3v3h-3zM4 17h3v3H4zM10.5 17h3v3h-3zM17 17h3v3h-3z"/>',
  arrowRight:'<path d="M4 12h16m0 0-6-6m6 6-6 6"/>',
  // ---- fleet-app glyphs (one per suite app, used by the launcher/waffle) ----
  briefcase:'<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  car:'<path d="M4 16v3h2.5v-2h11v2H20v-3M4 16l1.8-5.2A2 2 0 0 1 7.7 9.5h8.6a2 2 0 0 1 1.9 1.3L20 16M4 16h16"/><path d="M7 13.5h.01M17 13.5h.01"/>',
  network:'<circle cx="12" cy="5" r="2.2"/><circle cx="5" cy="18" r="2.2"/><circle cx="19" cy="18" r="2.2"/><path d="M10.8 6.8 6.3 16M13.2 6.8l4.5 9.2M7.2 18h9.6"/>',
  gamepad:'<path d="M6.5 8h11a4.5 4.5 0 0 1 4.4 5.4l-.8 4a2.5 2.5 0 0 1-4.3 1.2L14.6 16H9.4l-2.2 2.6a2.5 2.5 0 0 1-4.3-1.2l-.8-4A4.5 4.5 0 0 1 6.5 8Z"/><path d="M8 11v3M6.5 12.5h3M15.5 11.5h.01M17.5 13.5h.01"/>',
};

// App-registered icons live in a separate map so a sloppy app can't clobber
// the shell's base set by accident; lookups check the app map first so an
// app CAN deliberately override a base glyph for its own branding.
const APP = {};

export function icon(name, size=20){
  const p = APP[name] || P[name] || P.grid;
  return `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

// Merge an app-provided icon family. Values are either bare path data
// ('M12 5v14…' — wrapped in a <path> for you) or an inner-SVG string
// ('<path…/><circle…/>' — used verbatim inside the 24×24 wrapper). Keep app
// icons stroke-based/currentColor to stay on the fleet design bar.
export function registerIcons(map){
  for(const [name, v] of Object.entries(map||{})){
    if(!v) continue;
    const s = String(v).trim();
    APP[name] = s.startsWith('<') ? s : `<path d="${s}"/>`;
  }
}

// Every resolvable icon name (base set + registered), for pickers/demos.
export function iconNames(){
  return [...new Set([...Object.keys(P), ...Object.keys(APP)])];
}

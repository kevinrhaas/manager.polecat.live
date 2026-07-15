// -----------------------------------------------------------------------
// theme.js — two axes stamped on <html>: data-palette × data-theme,
// plus data-reduce-motion. Storage format "palette:mode" (e.g.
// "polecat:dark"), same convention as the fleet's app-local theme.js
// files, so adopting apps keep their historical keys via configure().
//
//   palette:  any key registered via configure() — v1 ships polecat /
//             aurora / neon in tokens.css; apps may add their own blocks.
//   mode:     'dark' | 'light' | 'system'  ('system' follows the OS live)
//
// Reduce-motion is a third, independent signal: the OS preference is
// honored by default, and a stored per-user override (`<key>.motion` =
// '1' force-on / '0' force-off) wins over it. Both stylesheet rules
// (html[data-reduce-motion="1"]) and JS (ui.js celebrate()) key off the
// stamped attribute.
// -----------------------------------------------------------------------

const mqLight  = window.matchMedia('(prefers-color-scheme: light)');
const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const DEFAULT_KEY = 'polecat.theme';

const cfg = {
  storageKey: DEFAULT_KEY,
  defaultTheme: 'polecat:dark',
  palettes: [
    { key:'polecat', label:'Polecat', hint:'Warm amber house style' },
    { key:'aurora',  label:'Aurora',  hint:'Violet / teal' },
    { key:'neon',    label:'Neon',    hint:'Miami-Vice magenta / cyan' },
  ],
};

export let PALETTES = cfg.palettes;
export const MODES = [
  { key:'dark',   label:'Dark' },
  { key:'light',  label:'Light' },
  { key:'system', label:'System' },
];

// Call before applyTheme(). Apps pass their historical storageKey
// ('as.theme.v1', 'jt.theme.v1', …) so adoption never wipes user state.
export function configure({ storageKey, palettes, defaultTheme }={}){
  if(storageKey) cfg.storageKey = storageKey;
  if(defaultTheme) cfg.defaultTheme = defaultTheme;
  if(palettes){ cfg.palettes = palettes; PALETTES = palettes; }
}

export function getTheme(){
  const raw = localStorage.getItem(cfg.storageKey) || cfg.defaultTheme;
  let [palette, mode] = raw.split(':');
  if(!cfg.palettes.some(p=>p.key===palette)) palette = cfg.defaultTheme.split(':')[0];
  if(!MODES.some(m=>m.key===mode)) mode = cfg.defaultTheme.split(':')[1] || 'dark';
  return { palette, mode };
}

export function setTheme(palette, mode){
  localStorage.setItem(cfg.storageKey, `${palette}:${mode}`);
  applyTheme();
}

// Resolve system → concrete light/dark using the OS preference.
function resolvedMode(mode){
  if(mode==='system') return mqLight.matches ? 'light' : 'dark';
  return mode;
}

// Convenience: current effective (light|dark) for choosing sun/moon icon etc.
export function effectiveMode(){ return resolvedMode(getTheme().mode); }

// Cycle just the light/dark mode of the current palette (topbar quick toggle).
export function toggleMode(){
  const { palette, mode } = getTheme();
  setTheme(palette, resolvedMode(mode)==='dark' ? 'light' : 'dark');
}

// ---- reduce motion --------------------------------------------------------
// Stored override beats the OS; absent override follows the OS.
export function reduceMotion(){
  const stored = localStorage.getItem(cfg.storageKey + '.motion');
  if(stored==='1') return true;
  if(stored==='0') return false;
  return mqMotion.matches;
}
// v: true force-on, false force-off, null/undefined = follow the OS again.
export function setReduceMotion(v){
  const k = cfg.storageKey + '.motion';
  if(v==null) localStorage.removeItem(k);
  else localStorage.setItem(k, v ? '1' : '0');
  applyTheme();
}

// ---- stamping --------------------------------------------------------------
export function applyTheme(){
  const { palette, mode } = getTheme();
  const root = document.documentElement;
  root.setAttribute('data-palette', palette);
  root.setAttribute('data-theme', resolvedMode(mode));
  if(reduceMotion()) root.setAttribute('data-reduce-motion','1');
  else root.removeAttribute('data-reduce-motion');
  // Keep the browser UI (address bar) in sync with the page surface. Read
  // the token instead of hardcoding per palette — apps add palettes freely.
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta){
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    if(bg) meta.setAttribute('content', bg);
  }
}

// ---- pre-paint snippet -----------------------------------------------------
// Inline <script> text for the document <head>: stamps data-palette /
// data-theme / data-reduce-motion from storage BEFORE first paint so there
// is no theme flash. Generate with the app's storageKey + default and paste
// (or template) the result into the HTML.
export function prepaintSnippet(storageKey=cfg.storageKey, defaultTheme=cfg.defaultTheme){
  return `(function(){try{var k='${storageKey}',v=localStorage.getItem(k)||'${defaultTheme}',p=v.split(':'),m=p[1]||'dark';`+
    `if(m==='system')m=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';`+
    `var d=document.documentElement;d.setAttribute('data-palette',p[0]);d.setAttribute('data-theme',m);`+
    `var r=localStorage.getItem(k+'.motion');`+
    `if(r==='1'||(r!=='0'&&matchMedia('(prefers-reduced-motion: reduce)').matches))d.setAttribute('data-reduce-motion','1');`+
    `}catch(e){}})();`;
}
// Ready-made snippet for the default key ('polecat.theme', polecat dark).
export const PREPAINT_SNIPPET = prepaintSnippet(DEFAULT_KEY, 'polecat:dark');

// Live listeners: follow the OS while in 'system' mode / no motion override.
mqLight.addEventListener?.('change', ()=>{ if(getTheme().mode==='system') applyTheme(); });
mqMotion.addEventListener?.('change', ()=>{ if(localStorage.getItem(cfg.storageKey+'.motion')==null) applyTheme(); });

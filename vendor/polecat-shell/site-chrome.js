// -----------------------------------------------------------------------
// site-chrome.js — shared PUBLIC-SITE header + footer builders for the
// fleet's marketing/landing pages. One source of truth so every app's front
// door carries the same brand tile, the same "back to polecat.live"
// affordance, the same layout, and the same footer. Pairs with
// site-chrome.css. See docs/BRAND.md for the standard this enforces.
//
// This is NOT the in-app shell (shell.js / initShell) — that's the rail +
// topbar inside the running app. This is only the landing-page chrome.
//
// Usage (an app marketing page):
//   import { siteHeader, siteFooter } from '/vendor/polecat-shell/site-chrome.js';
//   siteHeader('#siteHeader', {
//     app: 'manager',                                  // catalog id → icon+accent+name
//     nav: [{ href:'#features', label:'Features' }, …], // the app's own sections
//     cta: { href:'/app/', label:'Launch app' },
//   });
//   siteFooter('#siteFooter', { app: 'manager', docs:'/app/#docs', appUrl:'/app/',
//     notices:'THIRD-PARTY-NOTICES.md' });
//
// polecat.live (the root) uses the footer's root variant:
//   siteFooter('#siteFooter', { root: true, links:[…], meta:'© 2026 …' });
// -----------------------------------------------------------------------

import { fleetApp } from './catalog.js';
import { icon } from './icons.js';

const POLECAT = 'https://polecat.live';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function elFor(mount) {
  return typeof mount === 'string' ? document.querySelector(mount) : mount;
}
// Legible foreground (near-black or white) for text sitting ON the accent —
// so a light accent (sky, teal) gets dark text and a dark one gets white.
// Perceptual luminance, tuned threshold; falls back to white if unparseable.
function ctaFg(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? '#0b0a10' : '#fff';
}

// Resolve app identity from a catalog id string, or an explicit
// { name, icon, accent } object (for an app not in the catalog).
function ident(app) {
  if (typeof app === 'string') {
    const a = fleetApp(app);
    if (a) return { name: a.name, icon: a.icon, accent: a.accent };
  }
  return app || {};
}

export function siteHeader(mount, opts = {}) {
  const el = elFor(mount);
  if (!el) return null;
  const { name, icon: glyph, accent } = ident(opts.app);
  const nav = Array.isArray(opts.nav) ? opts.nav : [];
  const cta = opts.cta;
  const home = opts.home || '/';
  el.className = 'psx-header';
  if (opts.theme === 'auto') el.setAttribute('data-psx-theme', 'auto');
  if (accent) { el.style.setProperty('--psx-accent', accent); el.style.setProperty('--psx-cta-fg', ctaFg(accent)); }

  const links = nav.map(n =>
    `<a class="psx-section" href="${esc(n.href)}">${esc(n.label)}</a>`).join('');
  // Launching the app opens in a NEW TAB across the suite, so the marketing
  // page stays put behind it (opts.cta.sameTab opts out).
  const ctaTab = cta && cta.sameTab ? '' : ' target="_blank" rel="noopener"';
  const ctaHtml = cta
    ? `<a class="psx-cta" href="${esc(cta.href)}"${ctaTab}>${esc(cta.label)}${icon('arrowRight', 16)}</a>`
    : '';

  el.innerHTML =
    `<div class="psx-h-in">
      <a class="psx-brand" href="${esc(home)}" aria-label="${esc(name)} home">
        <span class="psx-tile">${icon(glyph || 'grid', 20)}</span>
        <span class="psx-brand-name">${esc(name)}</span>
      </a>
      <nav class="psx-nav" aria-label="Primary">
        ${links}${ctaHtml}
        <a class="psx-parent" href="${POLECAT}" aria-label="Polecat suite home">Pole<span class="psx-grad">cat</span></a>
      </nav>
    </div>`;

  // scroll shadow (rAF-throttled, passive)
  let ticking = false;
  const paint = () => { el.classList.toggle('psx-scrolled', window.scrollY > 4); ticking = false; };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(paint); } }, { passive: true });
  paint();
  return el;
}

export function siteFooter(mount, opts = {}) {
  const el = elFor(mount);
  if (!el) return null;
  el.className = 'psx-footer';
  if (opts.theme === 'auto') el.setAttribute('data-psx-theme', 'auto');
  const year = opts.year || 2026;

  // Root variant — polecat.live itself: the sharp wordmark + suite links.
  if (opts.root) {
    const links = (opts.links || []).map(l =>
      `<a href="${esc(l.href)}"${l.ext ? ' rel="noopener"' : ''}>${esc(l.label)}</a>`)
      .join('<span class="psx-dot" aria-hidden="true">·</span>');
    el.innerHTML =
      `<div class="psx-f-in psx-f-root">
        <div class="psx-wordmark">Pole<span class="psx-grad">cat</span></div>
        <nav class="psx-f-links" aria-label="Polecat">${links}</nav>
        <div class="psx-f-meta">${esc(opts.meta || `© ${year} Polecat.live`)}</div>
      </div>`;
    return el;
  }

  // App variant — the canonical two-line fleet footer:
  //   AppName · part of the polecat.live suite
  //   Docs · App · Third-party notices · © 2026 Polecat.live
  const { name, icon: glyph, accent } = ident(opts.app);
  if (accent) el.style.setProperty('--psx-accent', accent);
  const home = opts.home || '/';
  const l2 = [];
  if (opts.docs) l2.push(`<a href="${esc(opts.docs)}">Docs</a>`);
  // the footer "App" link is also a launch → new tab, matching the header CTA
  if (opts.appUrl) l2.push(`<a href="${esc(opts.appUrl)}" target="_blank" rel="noopener">App</a>`);
  if (opts.notices) l2.push(`<a href="${esc(opts.notices)}">Third-party notices</a>`);
  (opts.extraLinks || []).forEach(l => l2.push(`<a href="${esc(l.href)}"${l.ext ? ' rel="noopener"' : ''}>${esc(l.label)}</a>`));
  l2.push(`<span class="psx-copy">© ${year} Polecat.live</span>`);

  el.innerHTML =
    `<div class="psx-f-in">
      <div class="psx-f-l1">
        <a class="psx-brand" href="${esc(home)}" aria-label="${esc(name)} home">
          <span class="psx-tile psx-tile-sm">${icon(glyph || 'grid', 16)}</span>
          <span class="psx-brand-name">${esc(name)}</span>
        </a>
        <span class="psx-f-tag">part of the <a href="${POLECAT}">polecat.live</a> suite</span>
      </div>
      <nav class="psx-f-l2" aria-label="${esc(name)} footer">${l2.join('<span class="psx-dot" aria-hidden="true">·</span>')}</nav>
    </div>`;
  return el;
}

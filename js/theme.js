// Theme: dark (default) / light / system, persisted to localStorage.
const KEY='manager.theme';
const mq = window.matchMedia('(prefers-color-scheme: light)');

export function getThemePref(){ return localStorage.getItem(KEY) || 'dark'; }

export function applyTheme(){
  const pref=getThemePref();
  const light = pref==='light' || (pref==='system' && mq.matches);
  document.documentElement.setAttribute('data-theme', light?'light':'dark');
}

export function setTheme(pref){
  localStorage.setItem(KEY, pref);
  applyTheme();
}

// react to OS theme changes when in system mode
mq.addEventListener?.('change', ()=>{ if(getThemePref()==='system') applyTheme(); });

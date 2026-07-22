// Docs — complete in-app documentation for first-time users, with a sticky
// table of contents and scroll-spy.
import { el } from '../ui.js';
import { icon } from '../icons.js';

const SECTIONS = [
  { id:'start', title:'Getting started', body:`
    <p><b>Manager</b> is mission control for your fleet of self-improving Claude Code projects. Each project is a repo (and usually a live site) that improves itself on a schedule — driven by the <b>Polecat platform’s steward</b>, a set of GitHub Actions that build one unit of work at a time and ship it as a pull request merged only when the app’s own tests pass. Manager gives you one place to watch them all, drive that steward (see <b>Fleet Ops</b>), jump to the Claude Code session behind each project, and keep a curated library with rich metadata.</p>
    <p>Nothing here needs a server. Your data lives in this browser, modeled as tidy relational tables — and can mirror to a real database when you connect one (see <b>Data source</b>).</p>
    <ul>
      <li><b>Dashboard</b> — the live wall of project tiles.</li>
      <li><b>Projects</b> — the library: filter, sort, search, edit.</li>
      <li><b>Fleet Ops</b> — the steward console: schedules, runs, findings.</li>
      <li><b>Activity</b> — the self-improvement cadence log.</li>
      <li><b>Credentials</b> — shared or per-project config.</li>
    </ul>` },
  { id:'access', title:'Access & tokens', body:`
    <p>Manager is invite-only. There are two kinds of access:</p>
    <ul>
      <li><b>Admin token</b> — full access <i>and</i> the ability to mint invite links. It’s a private signing key; keep it secret. Paste it on the unlock screen or in <b>Admin</b>.</li>
      <li><b>User invite link</b> — a signed URL (<code>/app/?invite=…</code>) that unlocks the app for whoever opens it. Admins create these in <b>Admin → Create an invite</b>.</li>
    </ul>
    <p>Every invite is an unforgeable ECDSA signature verified entirely in your browser — there’s no server checking anything. Revoke a link any time from <b>Admin</b>.</p>` },
  { id:'dashboard', title:'The dashboard', body:`
    <p>Each <b>tile</b> summarizes one project: its status, the time it last shipped (in Central Time), the latest version, and a short assessment. The footer has quick links:</p>
    <ul>
      <li><b>What’s new</b> — opens the project’s release timeline.</li>
      <li><b>Site</b> — the live site, in a new tab.</li>
      <li><b>Session</b> — the Claude Code session you drive the work from. If you haven’t set one, click <b>Link session</b> to add its URL.</li>
    </ul>
    <p>Pinned projects float to the top. The stat row up top tracks fleet size, live count, releases in the last 7 days, and where you are in the feature/sweep cadence.</p>` },
  { id:'health', title:'Health, weighting & notifications', body:`
    <p>Every project carries a <b>health score</b> (0–100) blending three signals: how recently it shipped, how often (release velocity over the last 90 days), and its status. The score maps to one band — <b>Thriving</b>, <b>Healthy</b>, <b>Steady</b>, <b>Slowing</b>, or <b>Stale</b> — shown as a colored badge with a small 10-week sparkline next to it, on every dashboard tile and the project’s own health panel. The dashboard’s “Fleet health” stat card averages every project’s score.</p>
    <p>The three signals aren’t fixed: <b>Settings → “Fleet health weighting”</b> exposes them as drag sliders (always renormalized to sum to 100), with a one-click reset to the shipped default. A project that should be scored differently — say, one that’s deliberately slow-cadence — can get its own <b>Weighting</b> override from its health panel’s “Customize” link, scoped to just that project; turning it off falls straight back to the live fleet-wide weighting.</p>
    <p><b>“Needs attention”</b> flags a project once its health score sinks below a cutoff or its auto-sync fails too many times in a row — surfaced in three places that always agree: the notification <b>bell</b> in the top bar (with a live badge count and a click-through popover from anywhere in the app), a <b>badge on the Dashboard rail item</b>, and a <b>dashboard callout</b> listing every flagged project with its reasons and a one-click “Retry now”. Both cutoffs are tunable fleet-wide in <b>Settings → “Needs attention”</b>, with the same per-project <b>Attention</b> override (and a <b>Backoff cap</b> override for how aggressively a failing auto-sync backs off) available from the health panel.</p>
    <p>Steward signals count too: a <b>red steward PR</b> (a self-improvement change that failed its checks) or an <b>open sweep finding</b> on a project raises the same flag, with chips that click through to that project’s Steward card (see <b>Fleet Ops</b>).</p>
    <p>Seen a flagged project and don’t need to be reminded? <b>Dismiss</b> it from the bell, the callout, or its row — it drops out of the badge/callout until the exact reason changes (a merely-Slowing project that later starts failing sync too resurfaces immediately). Nothing is thrown away: a “N dismissed” link reopens a review list to restore any of them.</p>` },
  { id:'library', title:'Projects & the library', body:`
    <p>The <b>Projects</b> view is the source of truth. Use the search box, the status dropdown, and the sort controls — or tap a <b>saved view</b> chip (All, Live only, Recently active, Pinned, Needs attention) for a one-click preset. Your last view is remembered. Dial in any filter you like and click <b>Save view</b> to pin it as your own chip; once you’ve saved two or more, a <b>Reorder saved views</b> button appears to drag (or arrow-key) them into whichever order you check most often — the same modal has a pin toggle on each row to mark one your <b>default</b>: it opens automatically the next time you land on Projects, instead of always resuming whatever filter you left it on.</p>
    <p>Click any row to open the project. Click <b>Add project</b> (or the ✎ on a row) to edit. Every project supports:</p>
    <ul>
      <li>Name, repository (<code>owner/name</code>), live site, and the Claude Code session URL.</li>
      <li><b>Status</b> — <b>Live</b> (deployed &amp; in use), <b>Active</b> (actively worked on, but not a single deployed site), <b>Building</b> (toward launch), <b>Paused</b>, <b>Idea</b>, or <b>Archived</b>. Hover any status pill to see the difference. By default Manager <b>keeps status current from sync</b>: shipped recently → Live/Active, gone quiet for months → Paused. It never overrides <b>Archived</b> or a project you <b>Lock</b> (its health panel) — but an <b>Idea</b> does promote once it has real releases. Turn the whole behavior off in Settings → Status automation.</li>
      <li>Cadence, tags, an assessment, and an icon.</li>
      <li><b>Custom fields</b> — track anything (model, owner, budget…). They show on the project page.</li>
    </ul>
    <p>Pick a custom field in the toolbar to filter by it — a <b>Select</b> field gets a dropdown of its exact options, a <b>Number</b> field gets a <b>dual-handle range slider</b> (bounded to the real min/max in use today) so you can narrow to "budget between X and Y", and every other type filters by "contains".</p>
    <p>In <b>Settings → Custom fields</b>, drag a field's grip handle (or use its up/down arrows) to reorder the schema — that order drives where each field shows up on the project page, in the editor, and in this toolbar's own dropdowns.</p>
    <p><b>Settings → Tags</b> lists every tag in use across the fleet with how many projects carry it. Click the search icon on a row to jump straight to those projects in the library, rename a tag everywhere at once (renaming to one that already exists merges the two), or remove it from every project — all in a single Undo step.</p>
    <p>Check any number of rows (the header checkbox selects every currently visible one) to open the <b>bulk action bar</b> — add or remove a tag, set a status, archive, or delete the whole selection in one shot. <b>Remove tag</b> only offers tags actually present on the checked projects. Every bulk action is a single Undo (delete gets its own confirm first).</p>` },
  { id:'releases', title:'Releases & what’s new', body:`
    <p>Every project has its own <b>what’s-new timeline</b>. Open a project and click <b>Add release</b> to record one: a version number, a title, a kind (feature / polish / fix), and a bullet list of what changed. The newest release drives the tile’s “latest version” and “last shipped”. A small <b>legend</b> above the timeline explains every mark — the coloured dots (<b>Feature</b> / <b>Polish</b> / <b>Fix</b>), the <b>Milestone</b> flag, and the <b>Synced</b> tag — and each row repeats the same on hover.</p>
    <p>The <b>Releases</b> section (in the rail) is the fleet-wide view: every project’s releases in one timeline — newest first — with summary stats (last 7/30 days, who shipped), a <b>“this week” rollup</b> line you can copy as a one-liner for a status update, and filters by project, kind, time range, and text. Click any release to jump to that project. Toggle <b>By day / By project</b> to switch between a day-grouped timeline and clusters per project (most recently active first), and <b>Full / Digest</b> to collapse each group down to a one-line summary — click it to expand back to full cards, nothing is hidden for good. Use <b>Jump to date</b> to scroll straight to a day, expanding its group first if it’s collapsed. The rail badge shows how many releases shipped since you last opened this feed, and each one is tagged <b>new</b> until you do — a fleet-wide "since you last looked" marker, separate from the per-project sync preview.</p>
    <p><b>Copy / Export</b> (in the same toolbar) opens two ways to take the feed with you: <b>Copy as Markdown</b> turns exactly what’s on screen — your current filters, grouped the same way (by day or by project) — into a <span class="mono">## Releases</span> list ready to paste into a status update or PR description. <b>Download JSON</b> / <b>Download RSS</b> export a filter-independent snapshot of every project’s releases from the last 30 days, so “what shipped across the suite” can be piped into a feed reader or script instead of only ever pasted.</p>
    <p><b>Milestones &amp; recommended release points.</b> Not every release is worth remembering — some are a natural “this is stable, it’s done for now” point. On a project page, next to <b>What’s new</b>, Manager surfaces a <b>Recommended release point</b>: it reads the shape of the release history — a run of shipped features, then a stabilizing tail of polish/fix releases, a quiet pause before the next change, a round version number, and how recent it all is — and nominates the version that looks most like a complete, stable milestone, with a 0–10 confidence and the reasons why. It’s advisory: click <b>Mark as milestone</b> to accept it, <b>dismiss</b> (×) it to wave it off, or flag any release yourself with the 🚩 button (optionally with a label like “1.0” or “Public launch”). Once you mark or dismiss a suggestion it won’t nag you again, though a later stable point can surface a fresh one. Marked milestones get a badge everywhere the release shows, and the fleet-wide <b>Releases</b> feed has a <b>Milestones</b> filter to see just those stable points across every project.</p>
    <p>Manager itself also has a what’s-new panel — the ✨ button in the top bar — a slide-in panel with search and feature/polish/fix filters (the same feed every Polecat app shows).</p>
    <p><b>Sync</b> pulls a project’s real changelog and previews what’s new or changed before importing — safe and additive. <b>Force sync</b> (next to it) is a full reconcile: it overwrites any local edits to a matching release and removes synced releases no longer published upstream, behind a confirm since it’s deliberate. <b>Auto-sync</b> does the safe kind quietly — turn it on fleet-wide in Settings, then opt individual projects in from their health panel, and Manager re-checks them on a cadence without a modal in your way.</p>
    <p>Every project page also has a <b>Notes</b> card — a free-form Markdown scratchpad for working context that doesn’t belong in the curated assessment: why something’s paused, what to try next, a link to a design doc. It autosaves as you pause typing (no Save button), toggles between <b>Edit</b> and a rendered <b>Preview</b>, and keeps a <b>History</b> of prior versions you can browse and restore — a lightweight undo trail just for this text box.</p>` },
  { id:'credentials', title:'Credentials & config', body:`
    <p>Store shared secrets once as <b>global</b>, or scope them to a single project when they differ. Values are masked by default; reveal or copy them per row. Everything stays in this browser unless you connect a data source — and even then you can keep secret values out of the database in plaintext with <b>Encrypt secrets</b> (see Data source below).</p>
    <p>The vault is also where <b>Fleet Ops</b> finds its GitHub token: add a personal access token as a global credential and pick it once in Fleet Ops → GitHub access.</p>` },
  { id:'datasource', title:'Data source & backends', body:`
    <p>By default Manager keeps its whole workspace <b>in this browser</b> (fast, private, no setup) — the rail’s bottom chip shows <b>Local · this browser</b>. To reach the same data from another browser or device — and to put the fleet behind dashboards and other Polecat apps — connect a <b>database</b> from <b>Admin → Data source</b>.</p>
    <p>Manager talks to backends through one small <b>DataSource</b> interface, so this is the first of many: <b>Turso</b> (SQLite over HTTP) works end to end straight from the browser, and <b>Supabase</b> (Postgres) and <b>Firebase</b> (Firestore) are supported the same way — new backends are just another adapter. Pick one, paste its connection details (stored only in this browser), and Manager <b>inspects the database</b> and does the right thing:</p>
    <ul>
      <li><b>Empty database</b> → Manager creates all its objects and copies your current workspace up, then connects. (Supabase can’t create tables from the browser, so it hands you a one-time SQL script to paste into its editor first — after that, everything is automatic.)</li>
      <li><b>An existing Manager workspace</b> → it summarizes what’s there (schema version + row counts) and, on your go-ahead, loads it and makes it the source of truth.</li>
      <li><b>A database in use for something else</b> → Manager won’t touch it; it tells you what it found. As an explicit last resort you can drop everything there and set up fresh.</li>
    </ul>
    <p>Once connected, it’s a <b>write-through mirror</b>: you keep working against a fast local copy, and every change is <b>saved to the database automatically</b> on a short delay (the rail chip shows <b>connected / syncing / error</b>). Because writes are automatic there’s no “push” button — the manual action is <b>Refresh</b>, which <i>pulls</i> the latest in case you edited from another browser (there’s no live subscription yet). <b>Edit</b> updates the connection’s credentials in place; <b>Disconnect</b> goes back to local-only with your current data left in this browser. Open Manager in another browser, connect to the same database, and you pick up right where you left off. (User accounts and per-user access come later; today the connection is per-browser.)</p>
    <p><b>Encrypting your secrets.</b> By default the Credentials vault is stored on the database like everything else. To keep secret values out of the database in plaintext, turn on <b>Encrypt secrets</b> (Admin → Data source) and choose a passphrase: Manager AES-encrypts each credential value before it’s written to the remote, so the database only ever holds ciphertext. The passphrase <b>never leaves your browser</b> — it’s not stored on the server — so a leaked database dump reveals nothing without it. Connect from another browser and those secrets show as <b>🔒 locked</b> until you enter the same passphrase once to unlock them there. Keep the passphrase safe: if you lose it, the encrypted secrets can’t be recovered.</p>` },
  { id:'fleetops', title:'Fleet Ops & the steward', body:`
    <p>The fleet ships itself. Scheduled self-improvement runs centrally from the <b>polecat-platform</b> repo’s steward — GitHub Actions that pick one unit of work, build it on a branch, run that app’s own test gate, open a PR, and merge it only when green (a <b>janitor</b> job re-tests and merges anything a session left behind, every two hours). Manager’s console over all of it is split across two sections: <b>Fleet Ops</b> (the control room — schedules, one-off runs, and a “Coming up” timeline) and the <b>Steward log</b> (what has happened — safety nets, run reviews, open work):</p>
    <ul>
      <li><b>Focus roster</b> — every app’s recurring improve lane, with an on/off toggle and a cadence (hourly, every 2h, …). Committing a flip takes effect on the platform’s next hourly tick — no workflow edits.</li>
      <li><b>Run the steward now</b> — dispatch a one-off improve run focused on any project (or let the steward pick), plus the daily UX and Tech sweeps on demand. One-off runs don’t recur, so they’re free to fire.</li>
      <li><b>Fleet safety nets</b> — the janitor and both sweeps show their last outcome and when they ran, so a silently-failing safety net is visible here instead of buried in the Actions tab.</li>
      <li><b>Recent steward runs</b> — live-updating list (every 30s while open, with a token), each run labeled with the app it targeted and linked to its logs.</li>
      <li><b>Open steward work</b> — every open <code>steward/*</code> or shell-vendoring PR (with a live check dot: green merges on the janitor’s next pass, red is parked) and every unresolved sweep-finding issue, fleet-wide. Each project’s own page carries the same, scoped to its repo, on a <b>Steward</b> card.</li>
    </ul>
    <p><b>Connecting GitHub.</b> Reads work without any setup on public repos (with a small rate limit). To flip the roster, dispatch runs, and raise the limits, add a GitHub personal access token to the <b>Credentials vault</b> (repo + workflow scope on your repos), then pick it in Fleet Ops → <b>GitHub access</b>. Manager stores only which vault row to use — the token itself is read live from the vault, and an encrypted-locked value is never sent anywhere.</p>
    <p>Steward problems also ring the normal bell: a <b>red steward PR</b> or an <b>open sweep finding</b> on a project counts as a “Needs attention” reason — same chips, same badge, same dismissal rules as health and sync issues.</p>` },
  { id:'cadence', title:'Activity & the cadence', body:`
    <p>The <b>Activity</b> view is the run log — the record of self-improvement runs and the rhythm they follow (feature runs punctuated by design/polish sweeps). With scheduling now centralized in the platform steward (see <b>Fleet Ops</b>), this is where the history lives.</p>
    <p>You can log a run manually too — handy for recording work you did by hand.</p>` },
  { id:'personalize', title:'Simple mode, tour & themes', body:`
    <p><b>Simple mode</b> (Settings) trims the navigation to the essentials — great for a calmer, beginner-friendly view. The <b>welcome tour</b> can be replayed any time from Settings. Switch between <b>dark, light, and system</b> themes from the top bar or Settings.</p>` },
  { id:'data', title:'Your data, history & undo', body:`
    <p>Most actions can be <b>undone</b> — look for the “Undo” link in the toast, or use the undo control (⌘Z / Ctrl-Z). Manager keeps a bounded history of your recent edits.</p>
    <p>Deleted a project a few actions ago and moved on? Settings → Data → <b>Recently deleted</b> lists every project removed recently — single or bulk — so you can restore just the one you need (with its releases and credentials) without undoing everything that happened since.</p>
    <p>Export your whole workspace to JSON (Settings → Data) for backup, and import it on another device — or <b>Merge JSON</b> to add in another workspace's rows without replacing your own. Reset wipes local data back to the seeded fleet.</p>` },
  { id:'shortcuts', title:'Keyboard & tips', body:`
    <ul>
      <li><code>⌘K</code> / <code>Ctrl-K</code> — command palette: jump to any project, section, or action.</li>
      <li><code>⌘Z</code> / <code>Ctrl-Z</code> — undo your last change.</li>
      <li>Drag the rail’s edge to resize it; double-click to snap.</li>
      <li>Everything is responsive — Manager is built mobile-first.</li>
    </ul>` },
];

export function renderDocs(root, ctx){
  root.innerHTML='';
  const wrap=el('div',{class:'wrap view-in'});
  wrap.append(el('div',{class:'section-title', style:'margin-top:0', html:`<span style="color:var(--brand-b);display:inline-flex">${icon('book')}</span><h2>Documentation</h2>`}));

  const docs=el('div',{class:'docs'});
  const toc=el('nav',{class:'docs-toc'});
  const bodyCol=el('div',{class:'docs-body'});
  SECTIONS.forEach((s,i)=>{
    toc.append(el('a',{href:'#doc-'+s.id, 'data-doc':s.id, class:i===0?'active':'', text:s.title,
      onclick:(e)=>{ e.preventDefault(); document.getElementById('doc-'+s.id)?.scrollIntoView({behavior:'smooth', block:'start'}); }}));
    const sec=el('section',{id:'doc-'+s.id});
    sec.innerHTML=`<h2>${s.title}</h2>${s.body}`;
    bodyCol.append(sec);
  });
  docs.append(toc, bodyCol);
  wrap.append(docs);
  root.append(wrap);

  // scroll-spy on the scrolling .view container
  const view=root.closest('.view')||root.parentElement;
  const spy=()=>{
    let cur=SECTIONS[0].id;
    for(const s of SECTIONS){ const eln=document.getElementById('doc-'+s.id); if(eln && eln.getBoundingClientRect().top < 160) cur=s.id; }
    toc.querySelectorAll('a').forEach(a=>a.classList.toggle('active', a.dataset.doc===cur));
  };
  view.addEventListener('scroll', spy, { passive:true });
  spy();
}

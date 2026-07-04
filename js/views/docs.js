// Docs — complete in-app documentation for first-time users, with a sticky
// table of contents and scroll-spy.
import { el } from '../ui.js';
import { icon } from '../icons.js';

const SECTIONS = [
  { id:'start', title:'Getting started', body:`
    <p><b>Manager</b> is mission control for your fleet of self-improving Claude Code projects. Each project is a repo (and usually a live site) that improves itself on a schedule — a cron routine or a GitHub Action. Manager gives you one place to watch them all, jump to the Claude Code session driving each one, and keep a curated library with rich metadata.</p>
    <p>Nothing here needs a server. Your data lives in this browser, modeled as tidy relational tables so it can move to a real database (SQLite) later without losing anything.</p>
    <ul>
      <li><b>Dashboard</b> — the live wall of project tiles.</li>
      <li><b>Projects</b> — the library: filter, sort, search, edit.</li>
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
  { id:'library', title:'Projects & the library', body:`
    <p>The <b>Projects</b> view is the source of truth. Use the search box, the status dropdown, and the sort controls — or tap a <b>saved view</b> chip (All, Live only, Recently active, Pinned) for a one-click preset. Your last view is remembered. Dial in any filter you like and click <b>Save view</b> to pin it as your own chip; once you’ve saved two or more, a <b>Reorder saved views</b> button appears to drag (or arrow-key) them into whichever order you check most often — the same modal has a pin toggle on each row to mark one your <b>default</b>: it opens automatically the next time you land on Projects, instead of always resuming whatever filter you left it on.</p>
    <p>Click any row to open the project. Click <b>Add project</b> (or the ✎ on a row) to edit. Every project supports:</p>
    <ul>
      <li>Name, repository (<code>owner/name</code>), live site, and the Claude Code session URL.</li>
      <li><b>Status</b> — <b>Live</b> (deployed &amp; in use), <b>Active</b> (actively worked on, but not a single deployed site), <b>Building</b> (toward launch), <b>Paused</b>, <b>Idea</b>, or <b>Archived</b>. Hover any status pill to see the difference. By default Manager <b>keeps status current from sync</b>: shipped recently → Live/Active, gone quiet for months → Paused. It never overrides <b>Archived</b> or a project you <b>Lock</b> (its health panel) — but an <b>Idea</b> does promote once it has real releases. Turn the whole behavior off in Settings → Status automation.</li>
      <li>Cadence, tags, an assessment, and an icon.</li>
      <li><b>Custom fields</b> — track anything (model, owner, budget…). They show on the project page.</li>
    </ul>
    <p>Pick a custom field in the toolbar to filter by it — a <b>Select</b> field gets a dropdown of its exact options, a <b>Number</b> field gets a <b>dual-handle range slider</b> (bounded to the real min/max in use today) so you can narrow to "budget between X and Y", and every other type filters by "contains".</p>
    <p>In <b>Settings → Custom fields</b>, drag a field's grip handle (or use its up/down arrows) to reorder the schema — that order drives where each field shows up on the project page, in the editor, and in this toolbar's own dropdowns.</p>
    <p>Check any number of rows (the header checkbox selects every currently visible one) to open the <b>bulk action bar</b> — add or remove a tag, set a status, archive, or delete the whole selection in one shot. <b>Remove tag</b> only offers tags actually present on the checked projects. Every bulk action is a single Undo (delete gets its own confirm first).</p>` },
  { id:'releases', title:'Releases & what’s new', body:`
    <p>Every project has its own <b>what’s-new timeline</b>. Open a project and click <b>Add release</b> to record one: a version number, a title, a kind (feature / polish / fix), and a bullet list of what changed. The newest release drives the tile’s “latest version” and “last shipped”.</p>
    <p>The <b>Releases</b> section (in the rail) is the fleet-wide view: every project’s releases in one timeline — newest first — with summary stats (last 7/30 days, who shipped), a <b>“this week” rollup</b> line you can copy as a one-liner for a status update, and filters by project, kind, time range, and text. Click any release to jump to that project. Toggle <b>By day / By project</b> to switch between a day-grouped timeline and clusters per project (most recently active first), and <b>Full / Digest</b> to collapse each group down to a one-line summary — click it to expand back to full cards, nothing is hidden for good. Use <b>Jump to date</b> to scroll straight to a day, expanding its group first if it’s collapsed. The rail badge shows how many releases shipped since you last opened this feed, and each one is tagged <b>new</b> until you do — a fleet-wide "since you last looked" marker, separate from the per-project sync preview.</p>
    <p><b>Copy / Export</b> (in the same toolbar) opens two ways to take the feed with you: <b>Copy as Markdown</b> turns exactly what’s on screen — your current filters, grouped the same way (by day or by project) — into a <span class="mono">## Releases</span> list ready to paste into a status update or PR description. <b>Download JSON</b> / <b>Download RSS</b> export a filter-independent snapshot of every project’s releases from the last 30 days, so “what shipped across the suite” can be piped into a feed reader or script instead of only ever pasted.</p>
    <p>Manager itself also has a what’s-new panel — the ✨ button in the top bar — with search, filtering, and sorting.</p>
    <p><b>Sync</b> pulls a project’s real changelog and previews what’s new or changed before importing — safe and additive. <b>Force sync</b> (next to it) is a full reconcile: it overwrites any local edits to a matching release and removes synced releases no longer published upstream, behind a confirm since it’s deliberate. <b>Auto-sync</b> does the safe kind quietly — turn it on fleet-wide in Settings, then opt individual projects in from their health panel, and Manager re-checks them on a cadence without a modal in your way.</p>
    <p>Every project page also has a <b>Notes</b> card — a free-form Markdown scratchpad for working context that doesn’t belong in the curated assessment: why something’s paused, what to try next, a link to a design doc. It autosaves as you pause typing (no Save button), toggles between <b>Edit</b> and a rendered <b>Preview</b>, and keeps a <b>History</b> of prior versions you can browse and restore — a lightweight undo trail just for this text box.</p>` },
  { id:'credentials', title:'Credentials & config', body:`
    <p>Store shared secrets once as <b>global</b>, or scope them to a single project when they differ. Values are masked by default; reveal or copy them per row. Everything stays in this browser — nothing is uploaded. This is designed to graduate into an encrypted table when Manager gets a database.</p>` },
  { id:'cadence', title:'Activity & the cadence', body:`
    <p>Manager improves itself on a schedule. The rhythm is <b>four feature runs, then one sweep</b> — a design-and-feature polish pass across both the app and the public site. The <b>Activity</b> view shows the run log and previews the upcoming rhythm, so you always know when the next sweep lands.</p>
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

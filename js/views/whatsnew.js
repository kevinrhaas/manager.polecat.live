// "What's new" — Manager's own changelog, rendered by the vendored Polecat
// Shell: the fleet's generic What's-New feed (search + kind filters) inside
// the shell's slide-in right panel. Keeps Manager's historical seen-version
// key so nobody's unread dot resets on migration.
import { CHANGELOG, LATEST_VERSION } from '../changelog.js';
import { rightPanel } from '../../vendor/polecat-shell/shell.js';
import { initWhatsNew, hasUnseen } from '../../vendor/polecat-shell/whatsnew.js';

const SEEN_KEY = 'manager.whatsnew.seen';

export function hasUnread(){ return hasUnseen(SEEN_KEY, LATEST_VERSION); }

export function openWhatsNew(){
  const feed = initWhatsNew({ entries: CHANGELOG, latest: LATEST_VERSION, storageKey: SEEN_KEY });
  const { close } = rightPanel({ title: 'What’s new · Manager', body: feed });
  return { hide: close };
}

// icons.js — Manager's icon surface, served by the vendored Polecat Shell.
// The base set lives in vendor/polecat-shell/icons.js (single-color,
// stroke-based, currentColor — the fleet design bar). Only glyphs the shell
// doesn't ship are registered here as Manager's app family.
import { icon, registerIcons, iconNames } from '../vendor/polecat-shell/icons.js';

registerIcons({
  x:       'M6 6l12 12M18 6L6 18',
  warning: 'M12 2 1 21h22L12 2ZM12 9v5M12 17h.01',
});

export { icon, registerIcons, iconNames };

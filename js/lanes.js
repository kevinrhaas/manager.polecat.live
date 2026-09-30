// Named lanes are additive: existing apps retain their title and concurrency key.
export const PROCESSORS = ['claude', 'codex'];
export const EFFORTS = {
  claude: ['', 'low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['', 'low', 'medium', 'high', 'xhigh', 'max'],
};
export function appLanes(roster){
  return [
    ...Object.entries(roster.apps || {}).map(([app, config]) => ({ id: '', app, config })),
    ...Object.entries(roster.lanes || {}).map(([id, config]) => ({ id, app: config.app, config })),
  ];
}
export function validateLane({ id = '', app, config }){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(app || '')) throw new Error('Choose a valid app repository');
  if(id && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error('Invalid lane ID');
  const processor = config.processor || 'claude';
  if(!PROCESSORS.includes(processor)) throw new Error('Unknown processor');
  if(!EFFORTS[processor].includes(config.effort || '')) throw new Error('Unsupported effort for this processor');
  if(config.model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(config.model)) throw new Error('Use a model ID without spaces');
  if(config.model && ((processor === 'codex' && /^claude-/.test(config.model)) || (processor === 'claude' && /^gpt-/.test(config.model)))) throw new Error('Model belongs to the other processor');
  if(config.slices != null && (!Number.isInteger(config.slices) || config.slices < 1 || config.slices > 10)) throw new Error('Concurrency must be 1–10');
  if(config.max_turns != null && (!Number.isInteger(config.max_turns) || config.max_turns < 1 || config.max_turns > 2000)) throw new Error('Tool-call limit must be 1–2000');
  if(config.model && /haiku/.test(config.model) && config.effort) throw new Error('Haiku uses default effort');
  return { processor, model: config.model || '', effort: config.effort || '' };
}
export function laneTitle({ id, app }){
  return `Steward improve — ${app}${id ? ` {${id}}` : ''}`;
}
export function busySlots(lane, runs){
  const title = laneTitle(lane);
  return new Set(runs.filter(r => r.status !== 'completed').flatMap(r => {
    const name = r.display_title ?? r.displayTitle ?? '';
    if(name === title) return [1];
    if(!name.startsWith(title + ' [')) return [];
    const match = name.slice(title.length).match(/^ \[(\d+)\/\d+\]$/);
    return match ? [Number(match[1])] : [];
  }));
}
export function freeSlots(lane, runs){
  const n = Math.max(1, Math.min(10, Math.floor(Number(lane.config.slices) || 1)));
  const busy = busySlots(lane, runs);
  return Array.from({ length: n }, (_, i) => i + 1).filter(k => !busy.has(k)).slice(0, Math.max(0, n - busy.size));
}
export function dispatchInputs(lane, slice = 1){
  const settings = validateLane(lane);
  return { app: lane.app, lane: lane.id || '', ...settings, slice: String(slice),
    slices: String(lane.config.slices || 1), max_turns: String(lane.config.max_turns || '') };
}

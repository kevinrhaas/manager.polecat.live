import { el } from './ui.js';

export const MODEL_OPTIONS = {
  claude: [['', 'Default (Opus 5)'], ['claude-opus-5-5', 'Opus 5.5'], ['claude-opus-5', 'Opus 5'],
    ['claude-fable-5', 'Fable 5'], ['claude-sonnet-5', 'Sonnet 5'], ['claude-haiku-4-5', 'Haiku 4.5']],
  gpt: [['', 'Default (Astra 6)'], ['gpt-6-astra', 'Astra 6'], ['gpt-6-sol', 'Sol 6'], ['gpt-6.1-sol', 'Sol 6.1']],
};

export function rosterLanes(roster) {
  return [
    ...Object.entries(roster.apps || {}).map(([app, config]) => ({ key: app, app, config, label: app })),
    ...Object.entries(roster.lanes || {}).map(([id, config]) => ({ key: 'lane:' + id, id, app: config.app, config, label: `${config.app} · ${id}` })),
  ];
}

// Used by both recurring lanes and one-off dispatches; unknown IDs round-trip.
export function processorControls(config, label, change) {
  const wrap = el('div', { class: 'fo-processor-controls' });
  const field = (text, control) => el('label', { class: 'fo-processor-field' }, [el('span', { class: 'tiny muted', text }), control]);
  const provider = el('select', { class: 'input fo-processor', 'aria-label': `Processor for ${label}` });
  for (const [value, text] of [['claude', 'Claude Code'], ['gpt', 'GPT · Codex']]) provider.append(el('option', { value, text, selected: (config.processor || 'claude') === value }));
  const model = el('select', { class: 'input fo-model', 'aria-label': `Model for ${label}` });
  const custom = el('input', { class: 'input fo-custom-model', 'aria-label': `Exact model ID for ${label}`, placeholder: 'Exact model ID', value: config.model || '' });
  custom.maxLength = 120;
  const effort = el('select', { class: 'input fo-effort', 'aria-label': `Effort for ${label}` });
  for (const value of ['', 'low', 'medium', 'high', 'xhigh', 'max']) effort.append(el('option', { value, text: value || 'Model default', selected: (config.effort || '') === value }));
  const updateEffort = () => {
    effort.disabled = /haiku/.test(config.model || '');
    if (effort.disabled) { delete config.effort; effort.value = ''; }
  };
  const fill = () => {
    model.replaceChildren();
    const choices = MODEL_OPTIONS[config.processor || 'claude'];
    const known = choices.some(([id]) => id === (config.model || ''));
    for (const [value, text] of [...choices, ['custom', 'Custom model ID…']]) model.append(el('option', { value, text, selected: known ? value === (config.model || '') : value === 'custom' }));
    custom.hidden = known; custom.value = config.model || ''; updateEffort();
  };
  provider.addEventListener('change', () => { config.processor = provider.value; delete config.model; delete config.effort; effort.value = ''; fill(); change(); });
  model.addEventListener('change', () => {
    custom.hidden = model.value !== 'custom';
    if (model.value === 'custom') { custom.value = config.model || ''; custom.focus(); }
    else { config.model = model.value; updateEffort(); change(); }
  });
  custom.addEventListener('input', () => { config.model = custom.value.trim(); updateEffort(); change(); });
  effort.addEventListener('change', () => { config.effort = effort.value; change(); });
  fill();
  wrap.append(field('Processor', provider), field('Model', model), custom, field('Effort', effort));
  return wrap;
}

export function validateProcessor(config) {
  const processor = config.processor || 'claude';
  if (!MODEL_OPTIONS[processor]) throw new Error('Choose Claude or GPT as the processor.');
  if (config.model && !/^[a-zA-Z0-9][a-zA-Z0-9._:[\]-]{0,119}$/.test(config.model)) throw new Error('Enter a valid model ID.');
  if (processor === 'gpt' && /^claude-/.test(config.model || '') || processor === 'claude' && /^gpt-/.test(config.model || '')) throw new Error('The model ID does not match the processor.');
  if (config.effort && !['low', 'medium', 'high', 'xhigh', 'max'].includes(config.effort)) throw new Error('Choose a valid effort level.');
}

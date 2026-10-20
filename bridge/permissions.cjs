const MODES = {
  read: { label: 'Read only', tools: ['read', 'grep', 'find', 'ls'] },
  edit: { label: 'Read & write', tools: ['read', 'grep', 'find', 'ls', 'write', 'edit'] },
  full: { label: 'Full access', tools: ['read', 'grep', 'find', 'ls', 'write', 'edit', 'bash'] }
};
function availableModes(ceiling) {
  const allowed = new Set(ceiling.split(','));
  return Object.entries(MODES).filter(([, mode]) => mode.tools.every(tool => allowed.has(tool)))
    .map(([id, mode]) => ({ id, label: mode.label }));
}
function toolsFor(mode, ceiling) {
  if (!Object.hasOwn(MODES, mode) || !availableModes(ceiling).some(value => value.id === mode)) throw new Error('This permission level is disabled by the computer bridge.');
  return MODES[mode].tools.join(',');
}
module.exports = { MODES, availableModes, toolsFor, FULL_TOOLS: MODES.full.tools.join(',') };

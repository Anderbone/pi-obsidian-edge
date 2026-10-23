import { isPermissionId, type PermissionMode } from '../shared/protocol';
export const MODES = {
  read: { label: 'Read only', tools: ['read', 'grep', 'find', 'ls'] },
  edit: { label: 'Read & write', tools: ['read', 'grep', 'find', 'ls', 'write', 'edit'] },
  full: { label: 'Full access', tools: ['read', 'grep', 'find', 'ls', 'write', 'edit', 'bash'] }
};
export function availableModes(ceiling: string): PermissionMode[] {
  const allowed = new Set(ceiling.split(','));
  return Object.entries(MODES).filter(([, mode]) => mode.tools.every(tool => allowed.has(tool)))
    .map(([id, mode]) => ({ id: id as PermissionMode['id'], label: mode.label }));
}
export function toolsFor(mode: unknown, ceiling: string): string {
  if (!isPermissionId(mode) || !availableModes(ceiling).some(value => value.id === mode)) throw new Error('This permission level is disabled by the computer bridge.');
  return MODES[mode].tools.join(',');
}
export const FULL_TOOLS = MODES.full.tools.join(',');

import { isRecord } from '../shared/protocol';
export interface NoteReference { name: string; path: string; }
function isNoteReference(value: unknown): value is NoteReference {
  return isRecord(value) && typeof value.name === 'string' && typeof value.path === 'string';
}

// Vault project notes live under projects/<project>; other layouts stay within
// the original top-level folder rather than guessing across unrelated folders.
export function noteCandidates<T extends { path: string }>(path: string, files: T[]): T[] {
  const exact = files.find(file => file.path === path);
  if (exact) return [exact];
  const parts = path.split('/');
  const project = parts.indexOf('projects');
  const scope = project >= 0 && project + 2 < parts.length
    ? parts.slice(0, project + 2).join('/') + '/'
    : parts.length > 1 ? parts[0] + '/' : '';
  const name = parts[parts.length - 1];
  return files.filter(file => file.path.startsWith(scope) && file.path.split('/').pop() === name);
}

const marker = '\n\n<note-context>\n';
export function userMessage(text: string): { text: string; references: NoteReference[] } {
  const start = text.indexOf(marker);
  if (start < 0) return { text, references: [] };
  const context = text.slice(start + marker.length);
  const manifest = context.match(/^References: (.+)$/m);
  if (manifest) {
    try {
      const items: unknown = JSON.parse(manifest[1]);
      if (Array.isArray(items) && items.every(isNoteReference)) {
        return { text: text.slice(0, start), references: items };
      }
    } catch { /* Older messages fall back to source names. */ }
  }
  const names = [...context.matchAll(/^Source: (.+)$/gm)].map(match => match[1]);
  return { text: text.slice(0, start), references: [...new Set(names)].map(name => ({ name, path: name.replace(/ \(selection\)$/, '') })) };
}

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
  text = text.split(REPLY_MARKER)[0];
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

// Sent with every request so the completion contract also works with older bridges.
const REPLY_MARKER = '\n\n<pi-edge-completion-requirements>\n';
export function completionPrompt(message: string): string {
  return message + REPLY_MARKER + `Complete the user's requested work before ending your turn. If the user asks you to edit a file, actually use the available tools and verify the saved file; a statement of intent is not completion. Respect requests for discussion or planning only and all permission boundaries.
In your final reply, use the user's language and explicitly state the outcome, then list the files actually created, modified or deleted in this turn with their paths and a short description. If no files changed, explicitly say so. If blocked, interrupted, failed or unfinished, say what remains and why. Never claim a file was changed without evidence. Distinguish completed work from proposed next steps.
</pi-edge-completion-requirements>`;
}

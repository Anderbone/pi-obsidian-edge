import { ChatPanel } from '../src/panel';
const root = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
const panel = new ChatPanel(root, {
  send(text, attachments) {
    panel.handle({ kind: 'message', id: String(Date.now()), role: 'user', text, final: true });
    panel.setBusy(true);
    setTimeout(() => {
      panel.handle({ kind: 'message', id: 'reply-' + Date.now(), role: 'assistant', text: `Preview only: ${attachments.length} attachment(s) selected. This preview does not contact Pi.`, final: true });
      panel.setBusy(false);
    }, 200);
  },
  stop() { panel.setBusy(false); }, pair() { panel.error('Preview only. Use the installed plugin to pair a computer.'); },
  settings() { panel.error('Preview only. Settings are available in Obsidian.'); }, fresh() { panel.restore([]); }, history() {},
  async attach(kind) { return { id: kind, name: kind === 'selection' ? 'Project notes (selection)' : 'Project notes.md', text: 'Preview note context.' }; },
  model() {}, markdown(text, element) { element.textContent = text; }, changed() {}
}, !params.has('unpaired'));
if (!params.has('unpaired')) panel.statusChanged('ready', 'Connected · Tailscale');

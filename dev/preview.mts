import { ChatPanel } from '../src/panel';
const root = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
root.classList.toggle('is-desktop-preview', params.has('desktop'));
// The standalone browser preview supplies Obsidian's global DOM helper.
window.createEl = (tag, options = {}, callback) => {
  const element = document.createElement(tag);
  const info = typeof options === 'string' ? { cls: options } : options;
  element.className = Array.isArray(info.cls) ? info.cls.join(' ') : info.cls || '';
  if (info.text !== undefined) element.textContent = String(info.text);
  callback?.(element);
  return element;
};
const panel = new ChatPanel(root, {
  send(text, attachments) {
    panel.handle({ kind: 'message', id: String(Date.now()), role: 'user', text, final: true });
    panel.setBusy(true);
    setTimeout(() => {
      panel.handle({ kind: 'message', id: 'reply-' + Date.now(), role: 'assistant', text: `Preview only: ${attachments.length} attachment(s) selected. This preview does not contact Pi.`, final: true });
      panel.setBusy(false);
    }, 200);
  },
  icon(element, name) {
    const paths: Record<string, string> = {plus:'M12 5v14M5 12h14',history:'M3 12a9 9 0 1 0 3-7M3 3v5h5M12 7v5l3 2',settings:'M4 7h16M4 17h16M8 4v6M16 14v6', 'file-text':'M14 2H6v20h14V8zM14 2v6h6M9 13h6M9 17h6', 'text-select':'M4 4h16M12 4v16M8 20h8',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',image:'M3 3h18v18H3zM3 16l6-6 12 11M15 7h.01',square:'M5 5h14v14H5z','arrow-up':'M12 19V5M5 12l7-7 7 7',copy:'M9 9h12v12H9zM5 15H3V3h12v2'};
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[name]||paths.plus);svg.append(path);element.replaceChildren(svg);
  },
  stop() { panel.setBusy(false); }, pair() { panel.error('Preview only. Use the installed plugin to pair a computer.'); },
  settings() { panel.error('Preview only. Settings are available in Obsidian.'); }, fresh() { panel.restore([]); }, history() {},
  async attach(kind) { return { id: kind, name: kind === 'selection' ? 'Project notes (selection)' : 'Project notes.md', text: 'Preview note context.' }; },
  permissions(mode) { panel.setPermissions(mode, [{id: 'read', label:'Read only'}, {id:'edit',label:'Read & write'}, {id:'full',label:'Full access'}]); },
  model() {}, effort(level) { panel.setEffort(level); }, markdown(text, element) { element.textContent = text; }, changed() {}
}, !params.has('unpaired'));
if (!params.has('unpaired')) panel.statusChanged('ready', 'Connected');

if (!params.has('unpaired')) { panel.setModels([{id:'openai/gpt-6.1-sol',name:'GPT-6.1 Sol',provider:'openai'},{id:'example/chat',name:'Chat model',provider:'example'}], 'openai/gpt-6.1-sol'); panel.setEffortLevels(['low','medium','high','xhigh','max']); }

if (params.has('no-effort')) panel.setEffortLevels(['off']);
if (params.has('demo') && !params.has('unpaired')) {
  panel.restore([
    { id: 'demo-note', role: 'user', text: 'Turn this note into three next steps.\n\n<note-context>\nSource: Project notes.md\nPreview note context.\n</note-context>', final: true },
    { id: 'demo-summary', role: 'assistant', text: 'Start with a short outline, build one small prototype, then review what worked before expanding the project.', final: true },
    { id: 'demo-followup', role: 'user', text: 'Keep it focused on this week.', final: true },
    { id: 'demo-plan', role: 'assistant', text: 'This week: draft the outline, make a small prototype, and write down what you learn. Leave the rest in the backlog.', final: true }
  ]);
}
if (params.has('waiting')) { panel.restore([{id:'sample',role:'user',text:'Review the selected note.',final:true}]); panel.setBusy(true); }

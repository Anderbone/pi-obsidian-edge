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
if (!params.has('unpaired')) panel.statusChanged('ready', 'Connected · Tailscale');

if (!params.has('unpaired')) { panel.setModels([{id:'openai/gpt-6.1-sol',name:'GPT-6.1 Sol',provider:'openai'},{id:'example/chat',name:'Chat model',provider:'example'}], 'openai/gpt-6.1-sol'); panel.setEffortLevels(['low','medium','high','xhigh','max']); }

if (params.has('no-effort')) panel.setEffortLevels(['off']);
if (params.has('waiting')) { panel.restore([{id:'sample',role:'user',text:'Review the selected note.',final:true}]); panel.setBusy(true); }

/** A themed dialog keeps mobile selectors inside Obsidian's visual language. */
export class Picker {
  readonly button: HTMLButtonElement;
  private dialog?: HTMLDialogElement;
  constructor(private select: HTMLSelectElement, private title: string, private detail: string, private searchable = false) {
    select.classList.add('edge-picker-source');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    this.button = createEl('button', { cls: `${select.className.replace('edge-picker-source', '')} edge-picker-trigger` });
    this.button.type = 'button';
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.button.addEventListener('click', () => this.open());
    select.after(this.button);
    this.sync();
  }
  sync(): void {
    this.button.textContent = this.select.selectedOptions[0]?.textContent || this.title;
    this.button.title = this.title;
    this.button.setAttribute('aria-label', `${this.title}: ${this.button.textContent}`);
    this.button.hidden = this.select.hidden;
    this.button.disabled = this.select.disabled;
    if (this.dialog) this.dialog.close();
  }
  dispose(): void { this.dialog?.close(); this.dialog?.remove(); }
  private open(): void {
    this.dispose();
    const dialog = createEl('dialog');
    this.dialog = dialog; dialog.className = 'edge-picker-dialog';
    const header = dialog.createDiv({ cls: 'edge-picker-heading' });
    header.createEl('h3', { text: this.title });
    const close = header.createEl('button', { text: '×', attr: { 'aria-label': 'Close' } });
    close.type = 'button'; close.onclick = () => dialog.close();
    dialog.createEl('p', { cls: 'edge-picker-detail', text: this.detail });
    const search = this.searchable ? dialog.createEl('input', {
      cls: 'edge-picker-search', type: 'search',
      attr: { placeholder: 'Search models…', 'aria-label': 'Search models', autocomplete: 'off' },
    }) : undefined;
    const list = dialog.createDiv({ cls: 'edge-picker-list' });
    list.setAttribute('aria-live', 'polite');
    const render = () => {
      list.replaceChildren();
      const query = search?.value.trim().toLocaleLowerCase() || '';
      let group = '';
      for (const option of this.select.options) {
        const parent = option.parentElement;
        const label = parent?.tagName === 'OPTGROUP' ? (parent as HTMLOptGroupElement).label : '';
        if (query && !`${label} ${option.text} ${option.value}`.toLocaleLowerCase().includes(query)) continue;
        if (label && label !== group) { list.createDiv({ cls: 'edge-picker-group', text: label }); group = label; }
        const row = list.createEl('button', { cls: 'edge-picker-option' }); row.type = 'button';
        row.setAttribute('aria-pressed', String(option.selected)); row.disabled = option.disabled;
        row.createSpan({ text: option.text });
        row.createSpan({ cls: 'edge-picker-check', text: option.selected ? '✓' : '' });
        row.onclick = () => {
          this.select.value = option.value;
          this.select.dispatchEvent(new Event('change'));
          this.sync(); dialog.close();
        };
      }
      if (!list.childElementCount) list.createDiv({ cls: 'edge-picker-empty', text: 'No matching models' });
    };
    render();
    search?.addEventListener('input', render);
    search?.addEventListener('keydown', event => {
      if (event.isComposing) return;
      const first = list.querySelector<HTMLButtonElement>('button:not(:disabled)');
      if (event.key === 'ArrowDown') { event.preventDefault(); first?.focus(); }
      if (event.key === 'Enter') { event.preventDefault(); first?.click(); }
    });
    dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
    dialog.addEventListener('close', () => { dialog.remove(); if (this.dialog === dialog) this.dialog = undefined; this.button.focus(); }, { once: true });
    document.body.append(dialog); dialog.showModal();
    if (search) close.focus({ preventScroll: true });
    else list.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
  }
}

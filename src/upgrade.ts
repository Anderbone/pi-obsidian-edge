import { Modal, Notice, Setting, type App } from 'obsidian';

export const BRIDGE_VERSION = '0.3.3';
export const BRIDGE_COMMAND = `npx --yes https://github.com/Anderbone/pi-obsidian-edge/releases/download/bridge-${BRIDGE_VERSION}/pi-edge-bridge.tgz --cwd "/path/to/your/vault"`;
const UPGRADE_KEY = `pi-edge:upgrade:${BRIDGE_VERSION}`;

export function needsUpgradeNotice(app: App): boolean {
  return app.loadLocalStorage(UPGRADE_KEY) !== true;
}

export class UpgradeModal extends Modal {
  onOpen(): void {
    this.titleEl.setText('Pi Edge: update your computer bridge');
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- Preserve product names, exact UI labels and case-sensitive paths.
    this.contentEl.createEl('p', { text: 'Action needed on the computer running Pi: updating the Obsidian plugin does not update the bridge. The new Pi Durable backend saves chats and can recover unfinished work after a restart. If this computer already runs bridge 0.3.3, skip to step 4.' });
    const steps = this.contentEl.createEl('ol');
    steps.createEl('li', { text: 'Wait for running tasks to finish. On the computer, stop the old bridge with Ctrl+C. If it runs as a background service, stop that service first.' });
    steps.createEl('li', { text: 'Check that Node.js is 22.19 or newer. Run the command below in a computer terminal, replacing the quoted path with the same vault folder you used before. Keep your existing --host, --port, --url, --tools and --state-dir options, if any. Omit --backend cli to use Pi Durable.' });
    this.contentEl.createEl('pre').createEl('code', { text: BRIDGE_COMMAND });
    new Setting(this.contentEl).addButton(button => button.setButtonText('Copy command').onClick(async () => {
      try { await navigator.clipboard.writeText(BRIDGE_COMMAND); new Notice('Command copied. Replace the vault path before running it.'); }
      catch { new Notice('Could not copy. Select and copy the command above.'); }
    }));
    const rest = this.contentEl.createEl('ol', { attr: { start: '3' } });
    rest.createEl('li', { text: 'For a background service, replace its old bridge command with this new version and restart the service. Source-checkout installs: pull the new code, run npm ci, then restart your existing bridge service. Run only one bridge for this vault and state directory.' });
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- Preserve product names, exact UI labels and case-sensitive paths.
    rest.createEl('li', { text: 'In Obsidian on your phone or desktop, open Pi Edge settings → Test connection, then reopen a chat from History and send a message. Connected checks the connection; it does not verify the installed bridge version. If the computer bridge is already 0.3.3, no reinstall is needed.' });
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- Preserve product names, exact UI labels and case-sensitive paths.
    this.contentEl.createEl('p', { text: 'Keep ~/.config/pi-obsidian-edge/ (including token and durable/), any custom state directory, and ~/.pi/agent/. Use the same computer account and vault path. Your pairing and history are retained; pair again only if the address or token changed. Existing CLI chat context imports when first opened. Durable chats cannot be continued with --backend cli.' });
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- Preserve product names, exact UI labels and case-sensitive paths.
    this.contentEl.createEl('p', { text: 'You can reopen these steps in Pi Edge settings → Computer bridge update or the command palette → Pi Edge: Computer bridge update. Closing this window does not update or restart anything.' });
    this.contentEl.createEl('a', { text: 'Full upgrade guide', href: 'https://github.com/Anderbone/pi-obsidian-edge#upgrading-to-033', attr: { target: '_blank', rel: 'noopener' } });
    new Setting(this.contentEl).addButton(button => button.setButtonText('I’ve read these steps').setCta().onClick(() => {
      this.app.saveLocalStorage(UPGRADE_KEY, true);
      this.close();
    }));
  }
  onClose(): void { this.contentEl.empty(); }
}

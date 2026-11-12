import { Modal, Notice, Setting, type App } from 'obsidian';

export const BRIDGE_VERSION = '0.3.4';
export const BRIDGE_COMMAND = `npx --yes https://github.com/Anderbone/pi-obsidian-edge/releases/download/bridge-${BRIDGE_VERSION}/pi-edge-bridge.tgz --cwd "/path/to/your/vault"`;
const BRIDGE_STATE_PATHS = '~/.config/pi-obsidian-edge/ (including token and durable/)\n~/.pi/agent/';
const UPGRADE_KEY = `pi-edge:upgrade:${BRIDGE_VERSION}`;

export function needsUpgradeNotice(app: App): boolean {
  return app.loadLocalStorage(UPGRADE_KEY) !== true;
}

export class UpgradeModal extends Modal {
  onOpen(): void {
    this.titleEl.setText('Pi Edge: update your computer bridge');
    this.contentEl.createEl('p', { text: 'Action needed on the computer running Pi: updating this plugin does not update the bridge. The new persistent backend saves chats and can recover unfinished work after a restart. If this computer already runs bridge 0.3.3 or newer, skip to step 4.' });
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
    rest.createEl('li', { text: 'On your phone or desktop, open Pi Edge settings and test the connection, then reopen a chat from history and send a message. A successful connection check does not verify the installed bridge version. If the computer bridge is already 0.3.3 or newer, no reinstall is needed.' });
    this.contentEl.createEl('p', { text: 'Keep the private configuration folders below, including the token, chat storage and any custom state directory. Use the same computer account and vault path. Your pairing and history are retained; pair again only if the address or token changed. Existing chat context imports when first opened. Chats from the persistent backend cannot be continued with --backend cli.' });
    this.contentEl.createEl('pre').createEl('code', { text: BRIDGE_STATE_PATHS });
    this.contentEl.createEl('p', { text: 'You can reopen these steps from the computer bridge update entry in Pi Edge settings or the command palette. Closing this window does not update or restart anything.' });
    this.contentEl.createEl('a', { text: 'Full upgrade guide', href: 'https://github.com/Anderbone/pi-obsidian-edge#upgrading-to-034', attr: { target: '_blank', rel: 'noopener' } });
    new Setting(this.contentEl).addButton(button => button.setButtonText('I’ve read these steps').setCta().onClick(() => {
      this.app.saveLocalStorage(UPGRADE_KEY, true);
      this.close();
    }));
  }
  onClose(): void { this.contentEl.empty(); }
}

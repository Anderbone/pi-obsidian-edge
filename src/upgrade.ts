import { Modal, Notice, Setting, type App } from 'obsidian';

export const BRIDGE_VERSION = '0.3.7';
export const BRIDGE_COMMAND = `npx --yes https://github.com/Anderbone/pi-obsidian-edge/releases/download/bridge-${BRIDGE_VERSION}/pi-edge-bridge.tgz --cwd "/path/to/your/vault"`;
export const COMPUTER_AGENT_PROMPT = `Set up or update Pi Edge on this computer using Pi Durable.
Repository and guide: https://github.com/Anderbone/pi-obsidian-edge
Check Node.js 22.19+ and configure Pi model credentials; help me sign in if needed.
Find my existing vault and bridge configuration, or ask which vault to use.
Use the prebuilt bridge (Durable is bundled; no clone or build needed):
${BRIDGE_COMMAND}
Replace the placeholder with my computer's vault path. Use Tailscale if connected,
otherwise a trusted private LAN reachable from my Obsidian device.
For an existing installation, wait for active tasks to finish before restarting.
Preserve the account, vault path, pairing token, history, network/tool options,
private state directory and ~/.pi/agent/. Remove --backend cli. Update any existing
background service; run only one bridge per vault and state directory.
If Pi Durable bridge 0.3.3+ is already running, verify it rather than reinstalling.
Verify connectivity and model access. Keep the bridge running. Give me the pairing
code privately and tell me to paste it into Pi Edge: Pair computer in Obsidian.
If my existing pairing still works, tell me to open Pi Edge and send a message.`;

export function renderComputerSetup(container: HTMLElement): void {
  container.createEl('p', { text: 'On your computer, paste these instructions into your coding agent. It will set up Pi Durable and give you a pairing code.' });
  new Setting(container).addButton(button => button.setButtonText('Copy instructions for agent').setCta().onClick(async () => {
    try { await navigator.clipboard.writeText(COMPUTER_AGENT_PROMPT); new Notice('Copied. Paste into your coding agent on the computer.'); }
    catch { new Notice('Could not copy. Open the setup guide for instructions.'); }
  }));
  const manual = container.createEl('details');
  manual.createEl('summary', { text: 'Manual setup (without an agent)' });
  const steps = manual.createEl('ol');
  const install = steps.createEl('li');
  install.createEl('a', { text: 'Install Node.js 22.19+', href: 'https://nodejs.org/en/download', attr: { target: '_blank', rel: 'noopener' } });
  install.appendText('. ');
  install.createEl('a', { text: 'Set up Pi', href: 'https://pi.dev/docs/latest/quickstart', attr: { target: '_blank', rel: 'noopener' } });
  install.appendText('. Open pi on your computer, sign in, and try a message.');
  const start = steps.createEl('li', { text: 'Run this on your computer, replacing the quoted path with your vault folder. Pi Durable is included.' });
  start.createEl('pre', { cls: 'edge-setup-command' }).createEl('code', { text: BRIDGE_COMMAND });
  new Setting(start).addButton(button => button.setButtonText('Copy command').onClick(async () => {
    try { await navigator.clipboard.writeText(BRIDGE_COMMAND); new Notice('Copied. Replace the vault path before running.'); }
    catch { new Notice('Could not copy. Select the command above.'); }
  }));
  steps.createEl('li', { text: 'Keep it running. Connect both devices through the same private network or Tailscale, then paste its pairing code in Obsidian.' });
  manual.createEl('p', { text: 'Updating an existing bridge? Let tasks finish, stop it, and run the command with the same vault and options, removing --backend cli. Keep your pairing and stored data. Update the launch command too if you use a background service.' });
}
const UPGRADE_KEY = `pi-edge:upgrade:${BRIDGE_VERSION}`;

export function needsUpgradeNotice(app: App): boolean {
  return app.loadLocalStorage(UPGRADE_KEY) !== true;
}

export function acknowledgeUpgradeNotice(app: App): void {
  app.saveLocalStorage(UPGRADE_KEY, true);
}

export class UpgradeModal extends Modal {
  onOpen(): void {
    this.titleEl.setText('Connect your computer');
    renderComputerSetup(this.contentEl);
    this.contentEl.createEl('p', { text: 'Back in Obsidian, open Pi Edge settings and pair your computer with the code. Already paired? Open your chat and send a message.' });
    this.contentEl.createEl('a', { text: 'Setup guide', href: 'https://github.com/Anderbone/pi-obsidian-edge#setup', attr: { target: '_blank', rel: 'noopener' } });
    new Setting(this.contentEl).addButton(button => button.setButtonText('Done').setCta().onClick(() => {
      acknowledgeUpgradeNotice(this.app);
      this.close();
    }));
  }
  onClose(): void { this.contentEl.empty(); }
}

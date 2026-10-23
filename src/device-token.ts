interface VaultLocalStorage {
  loadLocalStorage(key: string): unknown;
  saveLocalStorage(key: string, data: unknown | null): void;
}

const TOKEN_KEY = 'pi-edge:token';

/** Device-local pairing credentials; never written to synced plugin data. */
export class DeviceToken {
  constructor(private app: VaultLocalStorage) {}

  get(): string {
    const token = this.app.loadLocalStorage(TOKEN_KEY);
    return typeof token === 'string' ? token : '';
  }

  set(token: string): void { this.app.saveLocalStorage(TOKEN_KEY, token || null); }

  /** Keep pre-0.2.6 pairings; remove the old key only after a verified write. */
  migrate(legacy: Pick<Storage, 'getItem' | 'removeItem'>, key: string): void {
    const token = legacy.getItem(key);
    if (!token) return;
    if (!this.get()) this.set(token);
    if (this.get()) legacy.removeItem(key);
  }
}

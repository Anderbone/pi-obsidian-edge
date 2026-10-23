import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeviceToken } from '../src/device-token';

function storage() {
  const values = new Map<string, unknown>();
  return {
    values,
    loadLocalStorage: (key: string): unknown => values.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown | null): void => {
      if (value === null) values.delete(key); else values.set(key, value);
    }
  };
}
function legacy(token: string) {
  const values = new Map([['old-vault-token', token]]);
  return { values, getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => { values.delete(key); } };
}

test('device credentials remain isolated to the app vault storage and support clearing', () => {
  const first = new DeviceToken(storage());
  const second = new DeviceToken(storage());
  first.set('private-token');
  assert.equal(first.get(), 'private-token');
  assert.equal(second.get(), '');
  first.set('');
  assert.equal(first.get(), '');
});

test('existing device pairing migrates once without changing its token', () => {
  const app = storage();
  const tokens = new DeviceToken(app);
  const old = legacy('existing-token');
  tokens.migrate(old, 'old-vault-token');
  assert.equal(tokens.get(), 'existing-token');
  assert.equal(old.values.size, 0);
  tokens.migrate(old, 'old-vault-token');
  assert.equal(tokens.get(), 'existing-token');
  tokens.set('');
  tokens.migrate(old, 'old-vault-token');
  assert.equal(tokens.get(), '');
});

test('migration preserves a newer pairing and never deletes legacy data after a failed write', () => {
  const app = storage();
  const tokens = new DeviceToken(app);
  tokens.set('new-token');
  const old = legacy('old-token');
  tokens.migrate(old, 'old-vault-token');
  assert.equal(tokens.get(), 'new-token');
  const blocked = new DeviceToken({ loadLocalStorage: () => null, saveLocalStorage: () => { throw new Error('storage unavailable'); } });
  const original = legacy('keep-me');
  assert.throws(() => blocked.migrate(original, 'old-vault-token'), /storage unavailable/);
  assert.equal(original.getItem('old-vault-token'), 'keep-me');
});

test('a malformed stored value cannot become a pairing token', () => {
  const app = storage();
  app.values.set('pi-edge:token', { token: 'unexpected-object' });
  assert.equal(new DeviceToken(app).get(), '');
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveNetwork, lanAddress } = require('../bridge/network.cjs');

test('Tailscale is optional; explicit hosts and proxy URLs bypass discovery', () => {
  assert.deepEqual(resolveNetwork({}, () => undefined, () => undefined), { host: '127.0.0.1', port: 8771, url: 'ws://127.0.0.1:8771' });
  assert.equal(resolveNetwork({}, () => undefined, () => '192.168.1.20').host, '192.168.1.20');
  assert.equal(resolveNetwork({}, () => '100.64.0.7').host, '100.64.0.7');
  const unexpected = () => { throw new Error('Must not discover'); };
  for (const host of ['192.168.1.20', '127.0.0.1', 'computer.local', '10.8.0.2']) {
    assert.deepEqual(resolveNetwork({ host, port: '9881' }, unexpected), { host, port: 9881, url: `ws://${host}:9881` });
  }
  assert.deepEqual(resolveNetwork({ url: 'wss://pi.example.com/edge/rpc/' }, unexpected), {
    host: '127.0.0.1', port: 8771, url: 'wss://pi.example.com/edge'
  });
});
test('LAN discovery selects a private physical interface rather than a container or loopback', () => {
  const address = (address, internal = false) => ({ address, internal, family: 'IPv4' });
  assert.equal(lanAddress({ lo: [address('127.0.0.1', true)], docker0: [address('172.17.0.1')], wlan0: [address('192.168.1.20')] }), '192.168.1.20');
  assert.equal(lanAddress({ eth0: [address('203.0.113.7'), address('169.254.1.2')] }), undefined);
});

test('IPv6 hosts are bracketed in connection codes; wildcard listeners need a reachable URL', () => {
  assert.deepEqual(resolveNetwork({ host: '[::1]' }), { host: '::1', port: 8771, url: 'ws://[::1]:8771' });
  assert.equal(resolveNetwork({ host: 'fd00::1' }).url, 'ws://[fd00::1]:8771');
  for (const host of ['0.0.0.0', '::']) {
    assert.throws(() => resolveNetwork({ host }), /--url/);
    assert.equal(resolveNetwork({ host, url: 'ws://192.168.1.20:8771' }).host, host);
  }
});

test('invalid bind addresses and pairing URLs fail before listening', () => {
  for (const host of ['ws://192.168.1.20', 'a/b', 'a b', '-bad', 'bad:port']) assert.throws(() => resolveNetwork({ host }));
  for (const port of ['0', '65536', 'NaN', '1.5']) assert.throws(() => resolveNetwork({ port }, () => undefined));
  for (const url of ['https://pi.example.com', 'ws://user:pass@host', 'ws://host/?token=secret', 'ws://host/#token', 'ws://0.0.0.0:8771', 'ws://[::]:8771']) {
    assert.throws(() => resolveNetwork({ url }));
  }
});

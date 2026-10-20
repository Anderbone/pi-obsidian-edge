import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelHeight } from '../src/viewport';
const base = { layoutHeight: 840, viewportHeight: 840, viewportTop: 0, keyboardHeight: 0, top: 38 };
test('overlay keyboard reduces available space when Android keeps the viewport unchanged', () => {
  assert.equal(panelHeight({ ...base, keyboardHeight: 320 }), 482);
});
test('resizing viewport handles keyboards without a native keyboard-height variable', () => {
  assert.equal(panelHeight({ ...base, viewportHeight: 520 }), 482);
});
test('does not subtract the keyboard twice when both APIs report its presence', () => {
  assert.equal(panelHeight({ ...base, viewportHeight: 520, keyboardHeight: 320 }), 482);
});
test('restores full space on close and bounds transient offscreen panels', () => {
  assert.equal(panelHeight(base), 802);
  assert.equal(panelHeight({ ...base, viewportHeight: 100, top: 200 }), 0);
});

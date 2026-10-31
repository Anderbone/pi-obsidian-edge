import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clipboardImageFiles, contentImages, imageSource, readClipboardImages } from '../src/images';

test('paste accepts item-only WebViews and does not attach the same file twice', () => {
  const image = new File(['image'], 'clipboard.png', { type: 'image/png' });
  const text = new File(['text'], 'note.txt', { type: 'text/plain' });
  const item = { kind: 'file', type: image.type, getAsFile: () => image };
  const transfer = (items: unknown[], files: File[]) => ({ items, files }) as unknown as DataTransfer;
  assert.deepEqual(clipboardImageFiles(transfer([item], [])), [image]);
  assert.deepEqual(clipboardImageFiles(transfer([item], [image, text])), [image]);
  assert.deepEqual(clipboardImageFiles(transfer([], [image, text])), [image]);
  assert.deepEqual(clipboardImageFiles(null), []);
});

test('clipboard API reads one supported image representation and reports an empty image clipboard', async t => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  t.after(() => { if (original) Object.defineProperty(navigator, 'clipboard', original); else Reflect.deleteProperty(navigator, 'clipboard'); });
  let items: unknown[] = [{ types: ['text/html', 'image/png', 'image/webp'], getType: (type: string) => new Blob(['pixels'], { type }) }];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read: async () => items } });
  const files = await readClipboardImages();
  assert.equal(files.length, 1); assert.equal(files[0].type, 'image/png'); assert.equal(await files[0].text(), 'pixels');
  items = [];
  await assert.rejects(readClipboardImages(), /No image found/);
});

test('history images permit embedded supported data and reject remote sources or active formats', () => {
  const image = { type: 'image' as const, mimeType: 'image/png', data: 'aGVsbG8=' };
  assert.deepEqual(contentImages([{ type: 'text', text: 'Look' }, image]), [image]);
  assert.equal(imageSource(image), 'data:image/png;base64,aGVsbG8=');
  for (const invalid of [{ ...image, mimeType: 'image/svg+xml' }, { ...image, data: 'https://example.com/image.png' }, { ...image, data: '' }]) {
    assert.equal(imageSource(invalid), undefined);
    assert.deepEqual(contentImages([invalid]), []);
  }
});

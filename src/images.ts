import { isRecord, type ImageInput } from '../shared/protocol';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

// Saved history and agent content are untrusted. Only render embedded image data.
export function imageSource(image: ImageInput): string | undefined {
  if (!IMAGE_TYPES.includes(image.mimeType) || !image.data || image.data.length > 5_333_336 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) return;
  return `data:${image.mimeType};base64,${image.data}`;
}

export function contentImages(content: unknown): ImageInput[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block: unknown) => {
    if (!isRecord(block) || block.type !== 'image' || typeof block.data !== 'string' || typeof block.mimeType !== 'string') return [];
    const image: ImageInput = { type: 'image', data: block.data, mimeType: block.mimeType };
    return imageSource(image) ? [image] : [];
  });
}

export function clipboardImageFiles(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  // Some WebViews expose image items without populating clipboardData.files.
  const items = Array.from(transfer.items || []).flatMap(item => {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
  const files = Array.from(transfer.files || []).filter(file => file.type.startsWith('image/'));
  return [...items, ...files.filter(file => !items.some(item => item.name === file.name && item.type === file.type && item.size === file.size && item.lastModified === file.lastModified))];
}

export async function readClipboardImages(): Promise<File[]> {
  if (typeof navigator.clipboard?.read !== 'function') throw new Error('Image clipboard access is unavailable. Use the image picker on this device.');
  const items = await navigator.clipboard.read();
  const files: File[] = [];
  for (const item of items) {
    const type = item.types.find(type => IMAGE_TYPES.includes(type));
    if (type) files.push(new File([await item.getType(type)], 'Pasted image', { type }));
  }
  if (!files.length) throw new Error('No image found on the clipboard. Copy an image first.');
  return files;
}

import { fitSize, MAX_BYTES } from './triggers.ts';

export type Attached = { mediaType: string; data: string };
const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export const isImage = (f: File) => TYPES.includes(f.type);

const toBase64 = (blob: Blob) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] ?? '');
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });

/** Reads a picture, shrinking it to 2000px on the long side (GIFs stay as they are: a canvas would freeze the animation). Returns undefined when it is still over 5 MB. */
export async function readImage(file: File): Promise<Attached | undefined> {
  let blob: Blob = file;
  if (file.type !== 'image/gif') {
    const bmp = await createImageBitmap(file);
    const { w, h } = fitSize(bmp.width, bmp.height);
    if (w !== bmp.width) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
      blob = (await new Promise<Blob | null>((ok) => c.toBlob(ok, file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9))) ?? file;
    }
    bmp.close();
  }
  if (blob.size > MAX_BYTES) return undefined;
  return { mediaType: blob.type || file.type, data: await toBase64(blob) };
}

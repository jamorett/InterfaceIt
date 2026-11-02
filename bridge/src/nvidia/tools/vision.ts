import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { NvidiaClient } from '../client.ts';
import { getNvidiaModel, thinkingParams } from '../models.ts';
import { resolveSafePath } from './read.ts';

/** The vision model behind both tools. It answered a real image request on a free NVIDIA endpoint (2026-11-02). */
export const VISION_MODEL = 'nvidia/nemotron-3.5-super-vl-120b-a12b';
/** the model card's recommended temperature for prompts with images */
const VISION_TEMPERATURE = 0.6;
/** NVIDIA's document element detector: hosted, answers with normalised boxes. Only for pages, charts and tables. */
const PAGE_ELEMENTS_URL = 'https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-page-elements-v3';

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const MAX_BYTES = 4_000_000;
const DOC_MAX_BASE64 = 180_000; // the detector's own limit for an inline image
const DISPLAY_MAX = 500_000; // bigger images are analysed but not copied into the event log

export interface VisionResult {
  text: string;
  isError: boolean;
  /** the image that was looked at, so the card can show it next to the verdict */
  imageData?: { mediaType: string; data: string }[];
}

interface Loaded { mediaType: string; data: string; bytes: number; width?: number; height?: number }

/** Width and height from the file header (PNG, JPEG, GIF); undefined for anything else. */
export function imageSize(b: Buffer): { width: number; height: number } | undefined {
  if (b.length > 24 && b.toString('latin1', 1, 4) === 'PNG') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 10 && b.toString('latin1', 0, 4) === 'GIF8') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) return undefined;
      const marker = b[i + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return undefined;
}

async function load(path: unknown, cwd: string, addDirs: string[]): Promise<Loaded | { error: string }> {
  if (typeof path !== 'string' || !path) return { error: 'Error: "path" is required.' };
  const mediaType = TYPES[extname(path).toLowerCase()];
  if (!mediaType) return { error: `Error: ${path} is not a PNG, JPEG, WebP or GIF image.` };
  const file = resolveSafePath(cwd, path, addDirs);
  try {
    const info = await stat(file);
    if (!info.isFile()) return { error: `Error: ${path} is not a file.` };
    if (info.size > MAX_BYTES) return { error: `Error: ${path} is ${(info.size / 1e6).toFixed(1)} MB; the limit is ${MAX_BYTES / 1e6} MB. Use a smaller screenshot.` };
    const buf = await readFile(file);
    return { mediaType, data: buf.toString('base64'), bytes: buf.length, ...imageSize(buf) };
  } catch (e) {
    return { error: `Error: cannot read ${path}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

const shown = (img: Loaded) => (img.bytes <= DISPLAY_MAX ? [{ mediaType: img.mediaType, data: img.data }] : undefined);
const dataUrl = (img: Loaded) => `data:${img.mediaType};base64,${img.data}`;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const REVIEW_SYSTEM = 'You look at an image for a developer who cannot see it. Describe only what is visible, concretely. For a user interface, point out the real problems you can see (clipped or overflowing text, overlapping elements, misalignment, low contrast, empty or broken areas) and say what looks right. Never invent details; if something is unclear, say so.';
const DEFAULT_QUESTION = 'Describe this image in detail. If it is a user interface, list the visible problems and what looks correct.';

export async function executeAnalyzeImage(input: { path: string; question?: string }, cwd: string, addDirs: string[], signal?: AbortSignal): Promise<VisionResult> {
  const img = await load(input.path, cwd, addDirs);
  if ('error' in img) return { text: img.error, isError: true };
  try {
    const res = await new NvidiaClient().streamChat(
      {
        model: VISION_MODEL,
        messages: [
          { role: 'system', content: REVIEW_SYSTEM },
          { role: 'user', content: [{ type: 'text', text: String(input.question ?? '').trim() || DEFAULT_QUESTION }, { type: 'image_url', image_url: { url: dataUrl(img) } }] },
        ],
        max_tokens: 1500,
        temperature: VISION_TEMPERATURE,
        enableThinking: false, // describing what is there needs no reasoning (checked); finding boxes does, see detect_objects
        signal,
      },
      {},
    );
    return { text: res.text.trim() || '(the vision model returned no description)', isError: false, imageData: shown(img) };
  } catch (e) {
    return { text: `Image analysis failed: ${msg(e)}`, isError: true };
  }
}

export interface Box { label: string; bbox: [number, number, number, number] }

/** The JSON array of boxes in a model's reply (it may wrap it in prose or a code fence), checked and clamped to the image. */
export function parseBoxes(reply: string, size?: { width: number; height: number }): Box[] | undefined {
  const start = reply.indexOf('[');
  const end = reply.lastIndexOf(']');
  if (start < 0 || end <= start) return undefined;
  let raw: unknown;
  try { raw = JSON.parse(reply.slice(start, end + 1)); } catch { return undefined; }
  if (!Array.isArray(raw)) return undefined;
  const clamp = (n: number, max?: number) => Math.round(max === undefined ? n : Math.min(Math.max(n, 0), max));
  return raw.flatMap((o): Box[] => {
    const r = o as { label?: unknown; bbox?: unknown };
    if (typeof r?.label !== 'string' || !Array.isArray(r.bbox) || r.bbox.length !== 4 || !r.bbox.every((n) => typeof n === 'number' && Number.isFinite(n))) return [];
    const [x1, y1, x2, y2] = r.bbox as number[];
    return [{ label: r.label, bbox: [clamp(x1!, size?.width), clamp(y1!, size?.height), clamp(x2!, size?.width), clamp(y2!, size?.height)] }];
  });
}

export async function executeDetectObjects(input: { path: string; query?: string; mode?: string }, cwd: string, addDirs: string[], signal?: AbortSignal): Promise<VisionResult> {
  const img = await load(input.path, cwd, addDirs);
  if ('error' in img) return { text: img.error, isError: true };
  const size = img.width && img.height ? { width: img.width, height: img.height } : undefined;
  const where = size ? `${size.width}x${size.height} image` : 'image';

  try {
    if (input.mode === 'document') {
      if (img.data.length > DOC_MAX_BASE64) return { text: `Error: the document detector takes images up to about ${Math.floor(DOC_MAX_BASE64 * 0.75 / 1000)} KB; this one is ${Math.round(img.bytes / 1000)} KB. Use mode "objects", or a smaller image.`, isError: true };
      const out = (await new NvidiaClient().postJson(PAGE_ELEMENTS_URL, { input: [{ type: 'image_url', url: dataUrl(img) }] }, signal)) as { data?: { bounding_boxes?: Record<string, { x_min: number; y_min: number; x_max: number; y_max: number; confidence: number }[]> }[] };
      const lines = Object.entries(out.data?.[0]?.bounding_boxes ?? {}).flatMap(([cls, boxes]) =>
        boxes.filter((b) => b.confidence >= 0.3).map((b) => {
          const px = size ? [b.x_min * size.width, b.y_min * size.height, b.x_max * size.width, b.y_max * size.height].map(Math.round) : [b.x_min, b.y_min, b.x_max, b.y_max].map((n) => Number(n.toFixed(3)));
          return `- ${cls}  [${px.join(', ')}]  confidence ${b.confidence.toFixed(2)}`;
        }));
      return { text: lines.length ? `Page elements found in the ${where} (${size ? 'pixels' : 'fractions of the image'}):\n${lines.join('\n')}` : `No charts, tables or titles were found in the ${where} with confidence of 0.3 or more.`, isError: false, imageData: shown(img) };
    }

    const query = String(input.query ?? '').trim();
    const ask = `Detect ${query ? `the objects matching: "${query}"` : 'every distinct object'}. Reply with ONLY a JSON array like [{"label":"...","bbox":[x1,y1,x2,y2]}] using pixel coordinates (origin top-left)${size ? ` of this ${size.width}x${size.height} image` : ''}. If nothing matches, reply [].`;
    const res = await new NvidiaClient().streamChat(
      { model: VISION_MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: ask }, { type: 'image_url', image_url: { url: dataUrl(img) } }] }], max_tokens: 4000, temperature: VISION_TEMPERATURE, ...thinkingParams(getNvidiaModel(VISION_MODEL), true, 'low'), signal },
      {},
    );
    const boxes = parseBoxes(res.text, size);
    if (!boxes) return { text: `The vision model did not return boxes. Its reply: ${res.text.trim().slice(0, 300)}`, isError: true };
    return {
      text: boxes.length
        ? `Found ${boxes.length} object${boxes.length === 1 ? '' : 's'} in the ${where} (pixels [x1, y1, x2, y2], origin top-left; approximate, from a vision-language model):\n${boxes.map((b) => `- ${b.label}  [${b.bbox.join(', ')}]`).join('\n')}`
        : `No objects${query ? ` matching "${query}"` : ''} were found in the ${where}.`,
      isError: false,
      imageData: shown(img),
    };
  } catch (e) {
    return { text: `Object detection failed: ${msg(e)}`, isError: true };
  }
}

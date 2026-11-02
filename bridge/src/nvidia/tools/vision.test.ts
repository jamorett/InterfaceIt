import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NvidiaClient } from '../client.ts';
import { executeAnalyzeImage, executeDetectObjects, imageSize, parseBoxes } from './vision.ts';

/** a real PNG: white, with the given size */
function png(width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ci-vision-'));
  writeFileSync(join(dir, 'shot.png'), png(300, 200));
  writeFileSync(join(dir, 'notes.txt'), 'not an image');
});
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
afterEach(() => vi.restoreAllMocks());

describe('image size', () => {
  it('reads PNG, GIF and JPEG headers', () => {
    expect(imageSize(png(300, 200))).toEqual({ width: 300, height: 200 });
    const gif = Buffer.alloc(16); gif.write('GIF89a'); gif.writeUInt16LE(64, 6); gif.writeUInt16LE(48, 8);
    expect(imageSize(gif)).toEqual({ width: 64, height: 48 });
    // SOI, an APP0 segment, then SOF0 with height 120 and width 160
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x78, 0x00, 0xa0, 0x03, 0x01, 0x11, 0x00]);
    expect(imageSize(jpg)).toEqual({ width: 160, height: 120 });
    expect(imageSize(Buffer.from('nothing'))).toBeUndefined();
  });
});

describe('parseBoxes', () => {
  it('takes the array out of prose or a code fence and clamps to the image', () => {
    const reply = 'Sure!\n```json\n[{"label":"button","bbox":[10.4,20,500,900]},{"label":"bad","bbox":[1,2,3]},{"nope":1}]\n```';
    expect(parseBoxes(reply, { width: 300, height: 200 })).toEqual([{ label: 'button', bbox: [10, 20, 300, 200] }]);
    expect(parseBoxes('[]')).toEqual([]);
  });
  it('says nothing when there is no JSON array', () => {
    expect(parseBoxes('I see a cat.')).toBeUndefined();
    expect(parseBoxes('[not json]')).toBeUndefined();
  });
});

describe('analyze_image', () => {
  it('sends the picture to the vision model with the question and returns its answer and the picture', async () => {
    const spy = vi.spyOn(NvidiaClient.prototype, 'streamChat').mockResolvedValue({ text: 'A white page. The title is cut off.', reasoning: '', toolCalls: [] });
    const r = await executeAnalyzeImage({ path: 'shot.png', question: 'Is anything cut off?' }, dir, []);
    expect(r).toMatchObject({ isError: false, text: 'A white page. The title is cut off.' });
    expect(r.imageData?.[0]?.mediaType).toBe('image/png');
    const req = spy.mock.calls[0]![0];
    expect(req.model).toBe('nvidia/nemotron-3.5-super-vl-120b-a12b');
    const user = req.messages.at(-1)!.content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(user[0]).toEqual({ type: 'text', text: 'Is anything cut off?' });
    expect(user[1]!.image_url!.url.startsWith('data:image/png;base64,')).toBe(true);
  });
  it('refuses what is not an image, a missing file, and reports a failing model clearly', async () => {
    expect((await executeAnalyzeImage({ path: 'notes.txt' }, dir, [])).text).toContain('not a PNG');
    expect((await executeAnalyzeImage({ path: 'nope.png' }, dir, [])).isError).toBe(true);
    vi.spyOn(NvidiaClient.prototype, 'streamChat').mockRejectedValue(new Error('HTTP 404'));
    expect((await executeAnalyzeImage({ path: 'shot.png' }, dir, [])).text).toContain('Image analysis failed: HTTP 404');
  });
});

describe('detect_objects', () => {
  it('lists boxes the model found, in pixels, with the image size in the prompt', async () => {
    const spy = vi.spyOn(NvidiaClient.prototype, 'streamChat').mockResolvedValue({ text: '[{"label":"red square","bbox":[30,40,110,120]}]', reasoning: '', toolCalls: [] });
    const r = await executeDetectObjects({ path: 'shot.png', query: 'squares' }, dir, []);
    expect(r.text).toContain('- red square  [30, 40, 110, 120]');
    expect(r.text).toContain('300x200 image');
    const ask = (spy.mock.calls[0]![0].messages[0]!.content as { text: string }[])[0]!.text;
    expect(ask).toContain('squares');
    expect(ask).toContain('300x200');
  });
  it('thinks (capped) to find boxes, and answers a description without thinking', async () => {
    const spy = vi.spyOn(NvidiaClient.prototype, 'streamChat').mockResolvedValue({ text: '[]', reasoning: '', toolCalls: [] });
    await executeDetectObjects({ path: 'shot.png' }, dir, []);
    expect(spy.mock.calls[0]![0]).toMatchObject({ enableThinking: true, reasoningBudget: 2048, temperature: 0.6 });
    await executeAnalyzeImage({ path: 'shot.png' }, dir, []);
    expect(spy.mock.calls[1]![0]).toMatchObject({ enableThinking: false, temperature: 0.6 });
  });
  it('reports a reply without boxes instead of inventing some', async () => {
    vi.spyOn(NvidiaClient.prototype, 'streamChat').mockResolvedValue({ text: 'There is a square.', reasoning: '', toolCalls: [] });
    const r = await executeDetectObjects({ path: 'shot.png' }, dir, []);
    expect(r.isError).toBe(true);
    expect(r.text).toContain('did not return boxes');
  });
  it('document mode turns the detector\'s fractions into pixels and drops weak detections', async () => {
    const post = vi.spyOn(NvidiaClient.prototype, 'postJson').mockResolvedValue({
      data: [{ bounding_boxes: { table: [{ x_min: 0.1, y_min: 0.25, x_max: 0.5, y_max: 0.75, confidence: 0.9 }], chart: [{ x_min: 0, y_min: 0, x_max: 1, y_max: 1, confidence: 0.1 }] } }],
    });
    const r = await executeDetectObjects({ path: 'shot.png', mode: 'document' }, dir, []);
    expect(post.mock.calls[0]![0]).toContain('/v1/cv/nvidia/nemotron-page-elements-v3');
    expect(r.text).toContain('- table  [30, 50, 150, 150]  confidence 0.90');
    expect(r.text).not.toContain('chart');
  });
});

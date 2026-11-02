import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { McpManager, mcpToolName } from './mcp.ts';

// a minimal MCP server: newline-delimited JSON-RPC on stdio, one tool "echo"
const SERVER = `
let buf = '';
process.stdin.on('data', (d) => {
  buf += d; const lines = buf.split('\\n'); buf = lines.pop();
  for (const l of lines) {
    if (!l.trim()) continue;
    const m = JSON.parse(l);
    const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
    if (m.method === 'initialize') reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } });
    else if (m.method === 'tools/list') reply({ tools: [{ name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] });
    else if (m.method === 'tools/call') reply({ content: [{ type: 'text', text: 'echo: ' + m.params.arguments.text }] });
  }
});
`;

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-'));
  writeFileSync(join(dir, 'server.cjs'), SERVER);
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { fake: { command: process.execPath, args: [join(dir, 'server.cjs')] }, remote: { url: 'https://example.com/mcp' } } }));
});
// the killed server may hold its cwd for a moment on Windows
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

describe('MCP client', () => {
  it('connects over stdio, lists tools under prefixed names and calls them', async () => {
    const m = new McpManager();
    await m.start(dir);
    try {
      expect(m.statuses()).toEqual(expect.arrayContaining([{ name: 'fake', status: 'connected' }, { name: 'remote', status: 'unsupported' }]));
      const defs = m.definitions();
      expect(defs.map((d) => d.function.name)).toContain('mcp__fake__echo');
      expect(defs[0]!.function.parameters.required).toEqual(['text']);
      expect(await m.call('mcp__fake__echo', { text: 'hi' })).toEqual({ text: 'echo: hi', isError: false });
      expect((await m.call('mcp__fake__nope', {})).isError).toBe(true);
    } finally {
      m.closeAll();
    }
  }, 30_000);

  it('names are safe and short', () => {
    expect(mcpToolName('my server', 'do.thing')).toBe('mcp__my_server__do_thing');
    expect(mcpToolName('s', 'x'.repeat(100)).length).toBe(64);
  });
});

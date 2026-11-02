import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { killTree } from './tools/bash.ts';
import type { OpenAiToolDefinition } from './tools/definitions.ts';

// shortcut: stdio servers only (the common kind: `npx some-mcp-server`); http/sse servers are listed as unsupported. Upgrade when one is needed.
export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
}

export type McpStatus = 'connecting' | 'connected' | 'failed' | 'unsupported';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** `mcpServers` from the user's ~/.claude.json and the project's .mcp.json (the project wins on a name clash). */
export function loadMcpConfigs(cwd: string): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  for (const file of [join(homedir(), '.claude.json'), join(cwd, '.mcp.json')]) {
    if (!existsSync(file)) continue;
    try {
      const servers = (JSON.parse(readFileSync(file, 'utf-8')) as { mcpServers?: unknown }).mcpServers;
      if (isRecord(servers)) for (const [name, cfg] of Object.entries(servers)) if (isRecord(cfg)) out[name] = cfg as McpServerConfig;
    } catch { /* unreadable or not JSON: no servers from this file */ }
  }
  return out;
}

const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
export const mcpToolName = (server: string, tool: string) => `mcp__${safe(server)}__${safe(tool)}`.slice(0, 64);

export class McpServer {
  status: McpStatus = 'connecting';
  tools: McpTool[] = [];
  private proc?: ChildProcess;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(readonly name: string, private cfg: McpServerConfig, private cwd: string) {}

  async connect(timeoutMs = 20_000): Promise<void> {
    if (!this.cfg.command) { this.status = 'unsupported'; return; }
    try {
      const win = process.platform === 'win32';
      // on Windows `npx` is a .cmd file and needs a shell, so the whole line is built and quoted here
      const quote = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
      const opts = { cwd: this.cwd, env: { ...process.env, ...this.cfg.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] as ['pipe', 'pipe', 'ignore'] };
      this.proc = win
        ? spawn([this.cfg.command, ...(this.cfg.args ?? [])].map(quote).join(' '), { ...opts, shell: true })
        : spawn(this.cfg.command, this.cfg.args ?? [], opts);
      this.proc.stdout!.on('data', (d: Buffer) => this.onData(d.toString('utf-8')));
      this.proc.on('error', (e) => this.fail(e));
      this.proc.on('close', () => this.fail(new Error('MCP server exited')));

      await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ClaudeInterface', version: '1.0.0' } }, timeoutMs);
      this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      const listed = (await this.request('tools/list', {}, timeoutMs)) as { tools?: McpTool[] };
      this.tools = (listed.tools ?? []).filter((t) => t && typeof t.name === 'string');
      this.status = 'connected';
    } catch {
      this.status = 'failed';
      this.close();
    }
  }

  definitions(): OpenAiToolDefinition[] {
    return this.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: mcpToolName(this.name, t.name),
        description: `[MCP server "${this.name}"] ${t.description ?? t.name}`.slice(0, 1000),
        parameters: { type: 'object' as const, properties: t.inputSchema?.properties ?? {}, ...(t.inputSchema?.required && { required: t.inputSchema.required }) },
      },
    }));
  }

  /** the server's own name for a tool the model called by its prefixed name */
  realToolName(prefixed: string): string | undefined {
    return this.tools.find((t) => mcpToolName(this.name, t.name) === prefixed)?.name;
  }

  async callTool(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; isError: boolean }> {
    try {
      const res = (await this.request('tools/call', { name: tool, arguments: args }, 120_000, signal)) as { content?: unknown[]; isError?: boolean };
      const text = (res.content ?? [])
        .map((c) => (isRecord(c) && c.type === 'text' ? String(c.text) : isRecord(c) && c.type === 'image' ? '[image]' : JSON.stringify(c)))
        .join('\n');
      return { text: text || '(no output)', isError: res.isError === true };
    } catch (e) {
      return { text: `MCP call failed: ${e instanceof Error ? e.message : String(e)}`, isError: true };
    }
  }

  close(): void {
    if (this.proc) killTree(this.proc);
    this.proc = undefined;
    this.fail(new Error('closed'));
  }

  private send(msg: object): void {
    this.proc?.stdin?.write(`${JSON.stringify(msg)}\n`);
  }

  private request(method: string, params: object, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      const done = <T>(fn: (v: T) => void) => (v: T) => { clearTimeout(timer); this.pending.delete(id); fn(v); };
      this.pending.set(id, { resolve: done(resolve), reject: done(reject) });
      signal?.addEventListener('abort', () => this.pending.get(id)?.reject(new Error('aborted')), { once: true });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(line); } catch { continue; } // not JSON: a log line the server printed to stdout
      if (typeof msg.id === 'number' && !msg.method) {
        const p = this.pending.get(msg.id);
        if (!p) continue;
        if (isRecord(msg.error)) p.reject(new Error(String(msg.error.message ?? 'MCP error')));
        else p.resolve(msg.result);
      } else if (msg.id !== undefined && msg.method) {
        // the server is asking us something (sampling, roots…): we support none of it, say so instead of leaving it waiting
        this.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not supported' } });
      }
    }
  }

  private fail(e: Error): void {
    for (const p of [...this.pending.values()]) p.reject(e);
    this.pending.clear();
  }
}

/** All MCP servers of a session. Starting never blocks the session: it reports back when done. */
export class McpManager {
  servers: McpServer[] = [];

  async start(cwd: string): Promise<void> {
    this.servers = Object.entries(loadMcpConfigs(cwd)).map(([name, cfg]) => new McpServer(name, cfg, cwd));
    await Promise.all(this.servers.map((s) => s.connect()));
  }

  definitions(): OpenAiToolDefinition[] {
    return this.servers.flatMap((s) => (s.status === 'connected' ? s.definitions() : []));
  }

  statuses(): { name: string; status: string }[] {
    return this.servers.map((s) => ({ name: s.name, status: s.status }));
  }

  isMcpTool(name: string): boolean {
    return name.startsWith('mcp__');
  }

  async call(prefixed: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; isError: boolean }> {
    for (const s of this.servers) {
      const real = s.status === 'connected' ? s.realToolName(prefixed) : undefined;
      if (real) return s.callTool(real, args, signal);
    }
    return { text: `Error: unknown MCP tool "${prefixed}".`, isError: true };
  }

  closeAll(): void {
    for (const s of this.servers) s.close();
  }
}
